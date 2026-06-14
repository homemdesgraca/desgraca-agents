import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentJob, AgentModelSelection } from "../agents/agent-job.ts";
import { createId, getAgentsRoot, sanitizeAgentName } from "../agents/agent-job.ts";
import type { AgentStore } from "../agents/agent-store.ts";
import type { AgentExtensionSettings } from "../settings/settings.ts";
import type { OrchestratorDraftStatus, OrchestratorSession, OrchestratorSessionSnapshot, OrchestratorSessionStatus, OrchestratorStartRequest, OrchestratorStartRequestStatus, OrchestratorTranscriptEntry, OrchestratorWorkerDraft } from "./orchestrator-session.ts";
import { appendJsonLine, ensureDir, readJsonFile, readJsonLines, writeJsonFileAtomic, writeTextFileAtomic } from "./persistence.ts";

const SESSION_FILE = "session.json";
const TRANSCRIPT_FILE = "transcript.jsonl";
const PLAN_FILE = "plan.md";
const DRAFTS_FILE = "drafts.json";
const START_REQUESTS_FILE = "start-requests.json";

export interface CreateOrchestratorSessionInput {
	title: string;
	model?: AgentModelSelection;
	initialPlan?: string;
}

export interface CreateOrUpdateDraftInput {
	name: string;
	task: string;
	order: number;
}

export interface CreateStartRequestInput {
	name: string;
	waitForResponse?: boolean;
	message?: string;
}

export interface ResolveStartRequestInput {
	status: "approved" | "denied";
	denialReason?: string;
}

type StoreListener = () => void;

function now(): number {
	return Date.now();
}

function taskSummary(task: string): string {
	const trimmed = task.replace(/\s+/g, " ").trim();
	return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function normalizeTitle(title: string): string {
	const trimmed = title.trim();
	return trimmed || `Orchestrator ${new Date().toLocaleString()}`;
}

function terminalAgentStatus(status: AgentJob["status"] | undefined): boolean {
	return status === "done" || status === "failed" || status === "aborted";
}

function draftStatusFromJob(job: AgentJob | undefined, fallback: OrchestratorDraftStatus): OrchestratorDraftStatus {
	if (!job) return fallback;
	if (job.status === "running" || job.status === "waiting" || job.status === "blocked") return "started";
	if (job.status === "done") return "done";
	if (job.status === "failed") return "failed";
	if (job.status === "aborted") return "aborted";
	return fallback;
}

export class OrchestratorStore {
	private sessions = new Map<string, OrchestratorSession>();
	private selectedSessionId: string | undefined;
	private listeners = new Set<StoreListener>();
	private cwd: string | undefined;
	private loading = false;

	constructor(private readonly agentStore: AgentStore) {}

	subscribe(listener: StoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		if (this.loading) return;
		for (const listener of this.listeners) listener();
	}

	async loadFromDisk(cwd: string): Promise<void> {
		this.loading = true;
		const resolvedCwd = path.resolve(cwd);
		this.cwd = resolvedCwd;
		this.sessions.clear();
		try {
			const sessionsRoot = this.sessionsRoot(resolvedCwd);
			await ensureDir(sessionsRoot);
			const entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const loaded = await this.loadSessionFile(path.join(sessionsRoot, entry.name));
				if (loaded) this.sessions.set(loaded.id, this.normalizeSession(loaded));
			}
		} finally {
			this.loading = false;
		}
		if (!this.selectedSessionId || !this.sessions.has(this.selectedSessionId)) this.selectedSessionId = this.list()[0]?.id;
		this.notify();
	}

	async refresh(): Promise<void> {
		if (!this.cwd) return;
		const selected = this.selectedSessionId;
		await this.loadFromDisk(this.cwd);
		if (selected && this.sessions.has(selected)) this.selectedSessionId = selected;
		await this.refreshStartRequestsFromJobs();
		this.notify();
	}

	list(): OrchestratorSession[] {
		return Array.from(this.sessions.values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	get(id: string | undefined): OrchestratorSession | undefined {
		return id ? this.sessions.get(id) : undefined;
	}

	getSelected(): OrchestratorSession | undefined {
		return this.get(this.selectedSessionId) ?? this.list()[0];
	}

	getSelectedId(): string | undefined {
		return this.getSelected()?.id;
	}

	select(id: string): OrchestratorSession | undefined {
		const session = this.sessions.get(id);
		if (!session) return undefined;
		this.selectedSessionId = id;
		this.notify();
		return session;
	}

	selectByIndex(index: number): OrchestratorSession | undefined {
		const session = this.list()[index];
		return session ? this.select(session.id) : undefined;
	}

	async create(cwd: string, input: CreateOrchestratorSessionInput): Promise<OrchestratorSession> {
		const resolvedCwd = path.resolve(cwd);
		this.cwd = resolvedCwd;
		const id = createId();
		const sessionDir = this.sessionDir(resolvedCwd, id);
		const timestamp = now();
		const session: OrchestratorSession = {
			id,
			title: normalizeTitle(input.title),
			cwd: resolvedCwd,
			status: "idle",
			model: input.model,
			activePlanPath: path.join(sessionDir, PLAN_FILE),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		await ensureDir(path.join(sessionDir, "notes"));
		await writeJsonFileAtomic(path.join(sessionDir, SESSION_FILE), session);
		await writeTextFileAtomic(path.join(sessionDir, PLAN_FILE), input.initialPlan ?? "");
		await writeJsonFileAtomic(path.join(sessionDir, DRAFTS_FILE), []);
		await writeJsonFileAtomic(path.join(sessionDir, START_REQUESTS_FILE), []);
		this.sessions.set(id, session);
		this.selectedSessionId = id;
		this.notify();
		return session;
	}

	async updateSession(id: string, patch: Partial<OrchestratorSession>): Promise<OrchestratorSession | undefined> {
		const session = this.sessions.get(id);
		if (!session || !this.cwd) return undefined;
		const updated: OrchestratorSession = { ...session, ...patch, updatedAt: now() };
		this.sessions.set(id, updated);
		await writeJsonFileAtomic(this.sessionFile(updated), updated);
		this.notify();
		return updated;
	}

	async setStatus(id: string, status: OrchestratorSessionStatus): Promise<OrchestratorSession | undefined> {
		const timestamp = now();
		return this.updateSession(id, {
			status,
			startedAt: status === "running" ? (this.sessions.get(id)?.startedAt ?? timestamp) : this.sessions.get(id)?.startedAt,
			finishedAt: ["done", "failed", "aborted"].includes(status) ? timestamp : this.sessions.get(id)?.finishedAt,
		});
	}

	async clearSession(id: string): Promise<OrchestratorSession | undefined> {
		const session = this.sessions.get(id);
		if (!session) return undefined;
		const sessionDir = this.sessionDir(session.cwd, session.id);
		await writeTextFileAtomic(path.join(sessionDir, PLAN_FILE), "");
		await writeTextFileAtomic(path.join(sessionDir, TRANSCRIPT_FILE), "");
		await writeJsonFileAtomic(path.join(sessionDir, DRAFTS_FILE), []);
		await writeJsonFileAtomic(path.join(sessionDir, START_REQUESTS_FILE), []);
		return this.updateSession(id, { status: "idle", waitingFor: undefined, process: undefined, finishedAt: undefined });
	}

	async deleteSession(id: string): Promise<boolean> {
		const session = this.sessions.get(id);
		if (!session) return false;
		this.sessions.delete(id);
		if (this.selectedSessionId === id) this.selectedSessionId = this.list()[0]?.id;
		await fs.rm(this.sessionDir(session.cwd, session.id), { recursive: true, force: true });
		this.notify();
		return true;
	}

	async appendTranscript(sessionId: string, entry: Omit<OrchestratorTranscriptEntry, "id" | "timestamp">): Promise<OrchestratorTranscriptEntry | undefined> {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		const fullEntry: OrchestratorTranscriptEntry = { ...entry, id: createId(), timestamp: now() };
		await appendJsonLine(path.join(this.sessionDir(session.cwd, session.id), TRANSCRIPT_FILE), fullEntry);
		await this.updateSession(sessionId, { updatedAt: now() });
		return fullEntry;
	}

	async getTranscript(sessionId: string, limit = 100): Promise<OrchestratorTranscriptEntry[]> {
		const session = this.sessions.get(sessionId);
		if (!session) return [];
		return readJsonLines<OrchestratorTranscriptEntry>(path.join(this.sessionDir(session.cwd, session.id), TRANSCRIPT_FILE), limit);
	}

	async readPlan(sessionId: string): Promise<string> {
		const session = this.sessions.get(sessionId);
		if (!session) return "";
		try {
			return await fs.readFile(path.join(this.sessionDir(session.cwd, session.id), PLAN_FILE), "utf8");
		} catch {
			return "";
		}
	}

	async writePlan(sessionId: string, content: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown orchestrator session: ${sessionId}`);
		await writeTextFileAtomic(path.join(this.sessionDir(session.cwd, session.id), PLAN_FILE), content);
		await this.appendTranscript(sessionId, { kind: "status", title: "Plan updated", message: "The orchestrator updated the current plan." });
	}

	async listDrafts(sessionId: string): Promise<OrchestratorWorkerDraft[]> {
		const session = this.sessions.get(sessionId);
		if (!session) return [];
		const drafts = await readJsonFile<OrchestratorWorkerDraft[]>(path.join(this.sessionDir(session.cwd, session.id), DRAFTS_FILE), []);
		return drafts.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
	}

	async saveDrafts(sessionId: string, drafts: OrchestratorWorkerDraft[]): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown orchestrator session: ${sessionId}`);
		await writeJsonFileAtomic(path.join(this.sessionDir(session.cwd, session.id), DRAFTS_FILE), drafts.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt));
		await this.updateSession(sessionId, { updatedAt: now() });
	}

	async createOrUpdateDraft(sessionId: string, input: CreateOrUpdateDraftInput, settings: AgentExtensionSettings): Promise<{ draft: OrchestratorWorkerDraft; job?: AgentJob; warning?: string }> {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown orchestrator session: ${sessionId}`);
		const name = sanitizeAgentName(input.name);
		const task = input.task.trim();
		if (!name) throw new Error("Worker name is required.");
		if (!task) throw new Error("Worker task is required.");
		if (!Number.isFinite(input.order) || input.order <= 0) throw new Error("Worker order must be a positive number.");

		const timestamp = now();
		const drafts = await this.listDrafts(sessionId);
		const existingIndex = drafts.findIndex((draft) => sanitizeAgentName(draft.name) === name);
		let draft: OrchestratorWorkerDraft;
		if (existingIndex >= 0) {
			draft = { ...drafts[existingIndex]!, name, task, order: input.order, updatedAt: timestamp };
			drafts[existingIndex] = draft;
		} else {
			draft = { id: createId(), sessionId, name, task, order: input.order, status: "queued", createdAt: timestamp, updatedAt: timestamp };
			drafts.push(draft);
		}

		const sync = await this.syncDraftToAgent(session, draft, settings);
		draft = { ...draft, agentJobId: sync.job.id, warning: sync.warning };
		const nextDrafts = drafts.map((item) => item.id === draft.id ? draft : item);
		await this.saveDrafts(sessionId, nextDrafts);
		await this.appendTranscript(sessionId, { kind: "tool", title: "Draft updated", toolName: "orchestrator_create_agent_draft", message: `${draft.order}. ${draft.name}`, output: sync.warning });
		return { draft, job: sync.job, warning: sync.warning };
	}

	async syncAllDrafts(settings: AgentExtensionSettings): Promise<void> {
		for (const session of this.list()) {
			const drafts = await this.listDrafts(session.id);
			let changed = false;
			const next: OrchestratorWorkerDraft[] = [];
			for (const draft of drafts) {
				if (draft.status === "discarded") {
					next.push(draft);
					continue;
				}
				const sync = await this.syncDraftToAgent(session, draft, settings);
				const job = sync.job;
				const status = draftStatusFromJob(job, draft.status);
				if (draft.agentJobId === job.id && draft.status === status && draft.warning === sync.warning) {
					next.push(draft);
					continue;
				}
				changed = true;
				next.push({ ...draft, agentJobId: job.id, status, warning: sync.warning, updatedAt: now() });
			}
			if (changed) await this.saveDrafts(session.id, next);
		}
	}

	async listStartRequests(sessionId: string): Promise<OrchestratorStartRequest[]> {
		const session = this.sessions.get(sessionId);
		if (!session) return [];
		return readJsonFile<OrchestratorStartRequest[]>(path.join(this.sessionDir(session.cwd, session.id), START_REQUESTS_FILE), []);
	}

	async saveStartRequests(sessionId: string, requests: OrchestratorStartRequest[]): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown orchestrator session: ${sessionId}`);
		await writeJsonFileAtomic(path.join(this.sessionDir(session.cwd, session.id), START_REQUESTS_FILE), requests);
		await this.updateSession(sessionId, { updatedAt: now() });
	}

	async createStartRequest(sessionId: string, input: CreateStartRequestInput): Promise<OrchestratorStartRequest> {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unknown orchestrator session: ${sessionId}`);
		const name = sanitizeAgentName(input.name);
		const drafts = await this.listDrafts(sessionId);
		const draft = drafts.find((item) => sanitizeAgentName(item.name) === name);
		const linkedJob = draft?.agentJobId ? this.agentStore.get(draft.agentJobId) : this.agentStore.list().find((job) => sanitizeAgentName(job.name) === name);
		if (!draft && !linkedJob) throw new Error(`No draft or agent named ${name}.`);
		const request: OrchestratorStartRequest = {
			id: createId(),
			sessionId,
			draftId: draft?.id,
			agentJobId: linkedJob?.id ?? draft?.agentJobId,
			agentName: linkedJob?.name ?? draft?.name ?? name,
			waitForResponse: !!input.waitForResponse,
			status: "pending",
			message: input.message ?? `Start agent ${linkedJob?.name ?? draft?.name ?? name}.`,
			createdAt: now(),
		};
		const requests = await this.listStartRequests(sessionId);
		await this.saveStartRequests(sessionId, [...requests, request]);
		await this.updateSession(sessionId, { status: "waiting_for_user", waitingFor: { kind: "start_request", requestId: request.id, agentJobId: request.agentJobId, agentName: request.agentName, since: now() } });
		await this.appendTranscript(sessionId, { kind: "status", title: "Start requested", message: request.message });
		return request;
	}

	async resolveStartRequest(sessionId: string, requestId: string, input: ResolveStartRequestInput): Promise<OrchestratorStartRequest | undefined> {
		const requests = await this.listStartRequests(sessionId);
		let resolved: OrchestratorStartRequest | undefined;
		const next = requests.map((request) => {
			if (request.id !== requestId) return request;
			resolved = {
				...request,
				status: input.status,
				resolvedAt: now(),
				denialReason: input.status === "denied" ? (input.denialReason || "Denied by user.") : request.denialReason,
			};
			return resolved;
		});
		await this.saveStartRequests(sessionId, next);
		if (resolved) await this.appendTranscript(sessionId, { kind: "status", title: input.status === "approved" ? "Start approved" : "Start denied", message: `${resolved.agentName}: ${input.status === "denied" ? resolved.denialReason : "approved by user"}` });
		if (input.status === "denied") await this.updateSession(sessionId, { status: "idle", waitingFor: undefined });
		return resolved;
	}

	async markStartRequestStarted(sessionId: string, requestId: string, agentJobId: string): Promise<OrchestratorStartRequest | undefined> {
		return this.patchStartRequest(sessionId, requestId, { status: "started", agentJobId, startedAt: now() });
	}

	async patchStartRequest(sessionId: string, requestId: string, patch: Partial<OrchestratorStartRequest>): Promise<OrchestratorStartRequest | undefined> {
		const requests = await this.listStartRequests(sessionId);
		let updated: OrchestratorStartRequest | undefined;
		const next = requests.map((request) => {
			if (request.id !== requestId) return request;
			updated = { ...request, ...patch };
			return updated;
		});
		await this.saveStartRequests(sessionId, next);
		return updated;
	}

	async refreshStartRequestsFromJobs(): Promise<void> {
		for (const session of this.list()) {
			const requests = await this.listStartRequests(session.id);
			let changed = false;
			const next = requests.map((request) => {
				if (!["approved", "started"].includes(request.status) || !request.agentJobId) return request;
				const job = this.agentStore.get(request.agentJobId);
				if (!job || !terminalAgentStatus(job.status)) return request;
				const status: OrchestratorStartRequestStatus = job.status === "done" ? "done" : job.status === "failed" ? "failed" : "aborted";
				changed = true;
				return { ...request, status, finishedAt: now(), resultSummary: job.finalResponse ? taskSummary(job.finalResponse) : `Worker ended with status ${job.status}.` };
			});
			if (changed) await this.saveStartRequests(session.id, next);
		}
	}

	async getSnapshot(sessionId: string, transcriptLimit = 60): Promise<OrchestratorSessionSnapshot | undefined> {
		const session = this.sessions.get(sessionId);
		if (!session) return undefined;
		return {
			session,
			plan: await this.readPlan(sessionId),
			drafts: await this.listDrafts(sessionId),
			startRequests: await this.listStartRequests(sessionId),
			transcript: await this.getTranscript(sessionId, transcriptLimit),
		};
	}

	getOrchestratorRoot(cwd = this.cwd): string {
		if (!cwd) throw new Error("Orchestrator store has not been loaded for a cwd.");
		return path.join(getAgentsRoot(path.resolve(cwd)), "_orchestrator");
	}

	getSessionDir(sessionId: string): string | undefined {
		const session = this.sessions.get(sessionId);
		return session ? this.sessionDir(session.cwd, session.id) : undefined;
	}

	private resolveDraftModel(session: OrchestratorSession, settings: AgentExtensionSettings): AgentModelSelection | undefined {
		const defaultModel = settings.agents.defaultModel;
		return defaultModel === "default" ? session.model : defaultModel;
	}

	private async syncDraftToAgent(session: OrchestratorSession, draft: OrchestratorWorkerDraft, settings: AgentExtensionSettings): Promise<{ job: AgentJob; warning?: string }> {
		const model = this.resolveDraftModel(session, settings);
		const sync = await this.agentStore.createOrUpdateFromOrchestratorDraft(session.cwd, {
			name: draft.name,
			task: draft.task,
			model,
			source: { kind: "orchestrator", sessionId: session.id, draftId: draft.id, order: draft.order },
		});
		return { job: sync.job, warning: sync.warning };
	}

	private sessionsRoot(cwd: string): string {
		return path.join(this.getOrchestratorRoot(cwd), "sessions");
	}

	private sessionDir(cwd: string, sessionId: string): string {
		return path.join(this.sessionsRoot(cwd), sessionId);
	}

	private sessionFile(session: OrchestratorSession): string {
		return path.join(this.sessionDir(session.cwd, session.id), SESSION_FILE);
	}

	private async loadSessionFile(sessionDir: string): Promise<OrchestratorSession | undefined> {
		const data = await readJsonFile<Partial<OrchestratorSession> | undefined>(path.join(sessionDir, SESSION_FILE), undefined);
		if (!data?.id || !data.cwd || !data.title) return undefined;
		return data as OrchestratorSession;
	}

	private normalizeSession(session: OrchestratorSession): OrchestratorSession {
		const timestamp = now();
		return {
			...session,
			status: session.status === "running" ? "idle" : session.status || "idle",
			activePlanPath: session.activePlanPath || path.join(this.sessionDir(session.cwd, session.id), PLAN_FILE),
			createdAt: session.createdAt ?? timestamp,
			updatedAt: session.updatedAt ?? timestamp,
			process: session.process ? { ...session.process, pid: undefined } : undefined,
			waitingFor: session.status === "running" ? undefined : session.waitingFor,
		};
	}

}
