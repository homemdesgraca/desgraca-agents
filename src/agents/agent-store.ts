import type { AgentApproval, AgentArtifact, AgentJob, AgentJobStatus, AgentLogEntry } from "./agent-job.ts";
import { createAgentJob, createId } from "./agent-job.ts";

type StoreListener = () => void;

type JobUpdater = (job: AgentJob) => AgentJob;

export class AgentStore {
	private jobs = new Map<string, AgentJob>();
	private selectedJobId: string | undefined;
	private listeners = new Set<StoreListener>();

	subscribe(listener: StoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}

	create(cwd: string, name: string, task: string): AgentJob {
		const job = createAgentJob(cwd, name, task);
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
}
