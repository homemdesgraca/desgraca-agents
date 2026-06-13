import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentApproval, AgentArtifact, AgentJob, AgentJobStatus, AgentLogEntry, AgentModelSelection, AgentTrackingEntry } from "./agent-job.ts";
import { createAgentJob, createId, getAgentsRoot } from "./agent-job.ts";

const JOB_STATE_FILE = "agent-job.json";

type StoreListener = () => void;

type JobUpdater = (job: AgentJob) => AgentJob;

export class AgentStore {
	private jobs = new Map<string, AgentJob>();
	private selectedJobId: string | undefined;
	private listeners = new Set<StoreListener>();
	private persistenceCwd: string | undefined;
	private loading = false;

	subscribe(listener: StoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		if (!this.loading) this.persistAllSoon();
		for (const listener of this.listeners) listener();
	}

	async loadFromDisk(cwd: string): Promise<void> {
		const resolvedCwd = path.resolve(cwd);
		if (this.persistenceCwd === resolvedCwd) return;
		this.loading = true;
		this.persistenceCwd = resolvedCwd;
		this.jobs.clear();
		this.selectedJobId = undefined;

		const agentsRoot = getAgentsRoot(resolvedCwd);
		try {
			await fs.mkdir(agentsRoot, { recursive: true });
			const entries = await fs.readdir(agentsRoot, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const writableRoot = path.join(agentsRoot, entry.name);
				const loaded = await this.loadJobFile(resolvedCwd, writableRoot);
				const job = loaded ?? createAgentJob(resolvedCwd, entry.name, "(imported existing workspace)");
				const normalized = this.normalizeLoadedJob(job, resolvedCwd, writableRoot);
				this.jobs.set(normalized.id, normalized);
			}
		} finally {
			this.loading = false;
		}
		this.notify();
	}

	create(cwd: string, name: string, task: string, model?: AgentModelSelection): AgentJob {
		if (!this.persistenceCwd) this.persistenceCwd = path.resolve(cwd);
		const job = createAgentJob(cwd, name, task, model);
		this.jobs.set(job.id, job);
		this.selectedJobId = job.id;
		this.notify();
		return job;
	}

	list(): AgentJob[] {
		return Array.from(this.jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	get(id: string | undefined): AgentJob | undefined {
		return id ? this.jobs.get(id) : undefined;
	}

	getSelected(): AgentJob | undefined {
		return this.get(this.selectedJobId) ?? this.list()[0];
	}

	getSelectedId(): string | undefined {
		return this.getSelected()?.id;
	}

	select(id: string): AgentJob | undefined {
		const job = this.jobs.get(id);
		if (!job) return undefined;
		this.selectedJobId = id;
		this.notify();
		return job;
	}

	selectByIndex(index: number): AgentJob | undefined {
		const job = this.list()[index];
		return job ? this.select(job.id) : undefined;
	}

	update(id: string, updater: Partial<AgentJob> | JobUpdater): AgentJob | undefined {
		const current = this.jobs.get(id);
		if (!current) return undefined;
		const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
		this.jobs.set(id, { ...next, updatedAt: Date.now() });
		this.notify();
		return this.jobs.get(id);
	}

	async delete(id: string): Promise<boolean> {
		const job = this.jobs.get(id);
		if (!job) return false;
		this.jobs.delete(id);
		if (this.selectedJobId === id) this.selectedJobId = this.list()[0]?.id;
		this.notify();
		await fs.rm(job.writableRoot, { recursive: true, force: true });
		return true;
	}

	setStatus(id: string, status: AgentJobStatus): AgentJob | undefined {
		const now = Date.now();
		return this.update(id, (job) => ({
			...job,
			status,
			startedAt: status === "running" && !job.startedAt ? now : job.startedAt,
			finishedAt: ["done", "failed", "aborted"].includes(status) ? now : job.finishedAt,
		}));
	}

	appendLog(id: string, message: string, level: AgentLogEntry["level"] = "info"): AgentLogEntry | undefined {
		const entry: AgentLogEntry = { id: createId(), timestamp: Date.now(), level, message };
		this.update(id, (job) => ({ ...job, logs: [...job.logs, entry].slice(-500) }));
		return entry;
	}

	appendTracking(id: string, tracking: Omit<AgentTrackingEntry, "id" | "timestamp">): AgentTrackingEntry | undefined {
		const entry: AgentTrackingEntry = { ...tracking, id: createId(), timestamp: Date.now() };
		this.update(id, (job) => ({ ...job, tracking: [...(job.tracking ?? []), entry].slice(-500) }));
		return entry;
	}

	appendApproval(id: string, approval: Omit<AgentApproval, "id" | "createdAt" | "status">): AgentApproval | undefined {
		const entry: AgentApproval = {
			...approval,
			id: createId(),
			createdAt: Date.now(),
			status: "pending",
		};
		this.update(id, (job) => ({ ...job, pendingApprovals: [...job.pendingApprovals, entry] }));
		return entry;
	}

	resolveApproval(jobId: string, approvalId: string, status: "approved" | "denied"): AgentApproval | undefined {
		let resolved: AgentApproval | undefined;
		this.update(jobId, (job) => ({
			...job,
			pendingApprovals: job.pendingApprovals.map((approval) => {
				if (approval.id !== approvalId) return approval;
				resolved = { ...approval, status, resolvedAt: Date.now() };
				return resolved;
			}),
		}));
		if (resolved) this.appendLog(jobId, `Approval ${status}: ${resolved.toolName} ${resolved.inputSummary}`);
		return resolved;
	}

	appendArtifact(id: string, artifact: AgentArtifact): AgentArtifact | undefined {
		this.update(id, (job) => {
			const withoutDuplicate = job.artifacts.filter((existing) => existing.path !== artifact.path);
			return { ...job, artifacts: [...withoutDuplicate, artifact].sort((a, b) => a.path.localeCompare(b.path)) };
		});
		return artifact;
	}

	setArtifacts(id: string, artifacts: AgentArtifact[]): AgentJob | undefined {
		return this.update(id, { artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)) });
	}

	private async loadJobFile(cwd: string, writableRoot: string): Promise<AgentJob | undefined> {
		const filePath = path.join(writableRoot, JOB_STATE_FILE);
		try {
			const data = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<AgentJob>;
			if (!data.id || !data.name) return undefined;
			return data as AgentJob;
		} catch {
			return undefined;
		}
	}

	private normalizeLoadedJob(job: AgentJob, cwd: string, writableRoot: string): AgentJob {
		const now = Date.now();
		const status = job.status === "running" ? "waiting" : job.status || "draft";
		const logs = Array.isArray(job.logs) ? job.logs : [];
		const tracking = Array.isArray(job.tracking) ? job.tracking : logs.map((log) => ({ id: log.id, timestamp: log.timestamp, kind: log.level === "error" ? "error" as const : "status" as const, title: log.level, message: log.message }));
		const restoredLog = job.status === "running"
			? [{ id: createId(), timestamp: now, level: "warning" as const, message: "Restored from disk; previous running subprocess is no longer attached." }]
			: [];
		return {
			...job,
			status,
			readableRoot: path.resolve(cwd),
			writableRoot,
			allowedTools: Array.isArray(job.allowedTools) ? job.allowedTools : ["read", "grep", "find", "ls"],
			logs: [...logs, ...restoredLog],
			tracking: [...tracking, ...restoredLog.map((log) => ({ id: createId(), timestamp: log.timestamp, kind: "status" as const, title: "Restored", message: log.message }))],
			pendingApprovals: Array.isArray(job.pendingApprovals) ? job.pendingApprovals : [],
			artifacts: Array.isArray(job.artifacts) ? job.artifacts : [],
			createdAt: job.createdAt ?? now,
			updatedAt: job.updatedAt ?? now,
			process: job.process ? { ...job.process, pid: undefined } : undefined,
		};
	}

	private persistAllSoon(): void {
		if (!this.persistenceCwd) return;
		void Promise.all([...this.jobs.values()].map((job) => this.persistJob(job))).catch(() => undefined);
	}

	private async persistJob(job: AgentJob): Promise<void> {
		if (!this.persistenceCwd) return;
		if (this.jobs.get(job.id) !== job) return;
		await fs.mkdir(job.writableRoot, { recursive: true });
		const filePath = path.join(job.writableRoot, JOB_STATE_FILE);
		const tmpPath = `${filePath}.tmp`;
		await fs.writeFile(tmpPath, JSON.stringify(job, null, 2));
		await fs.rename(tmpPath, filePath);
	}
}
