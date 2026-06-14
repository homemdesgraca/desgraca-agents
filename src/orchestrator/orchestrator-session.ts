import type { AgentJobStatus, AgentModelSelection } from "../agents/agent-job.ts";

export type OrchestratorSessionStatus = "idle" | "running" | "waiting_for_user" | "waiting_for_agent" | "failed" | "done" | "aborted";

export interface OrchestratorProcessMetadata {
	pid?: number;
	command?: string;
	args?: string[];
	startedAt?: number;
	exitedAt?: number;
	exitCode?: number | null;
	signal?: string | null;
}

export interface OrchestratorWaitState {
	kind: "start_request" | "agent";
	requestId?: string;
	agentJobId?: string;
	agentName?: string;
	since: number;
}

export interface OrchestratorSession {
	id: string;
	title: string;
	cwd: string;
	status: OrchestratorSessionStatus;
	orchestratorId?: string;
	orchestratorTitle?: string;
	threadTitle?: string;
	model?: AgentModelSelection;
	activePlanPath: string;
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	finishedAt?: number;
	process?: OrchestratorProcessMetadata;
	waitingFor?: OrchestratorWaitState;
}

export type OrchestratorTranscriptEntryKind = "user" | "assistant" | "tool" | "status" | "error";

export interface OrchestratorTranscriptEntry {
	id: string;
	timestamp: number;
	kind: OrchestratorTranscriptEntryKind;
	title: string;
	message?: string;
	toolName?: string;
	input?: string;
	output?: string;
}

export type OrchestratorDraftStatus = "draft" | "queued" | "started" | "done" | "failed" | "aborted" | "discarded";

export interface OrchestratorWorkerDraft {
	id: string;
	sessionId: string;
	name: string;
	task: string;
	order: number;
	status: OrchestratorDraftStatus;
	agentJobId?: string;
	createdAt: number;
	updatedAt: number;
	warning?: string;
}

export type OrchestratorStartRequestStatus = "pending" | "approved" | "denied" | "started" | "done" | "failed" | "aborted";

export type OrchestratorStartRequestKind = "agent" | "order";

export interface OrchestratorStartRequest {
	id: string;
	sessionId: string;
	kind?: OrchestratorStartRequestKind;
	draftId?: string;
	draftIds?: string[];
	agentJobId?: string;
	agentJobIds?: string[];
	agentName: string;
	agentNames?: string[];
	order?: number;
	waitForResponse: boolean;
	status: OrchestratorStartRequestStatus;
	message: string;
	createdAt: number;
	resolvedAt?: number;
	startedAt?: number;
	finishedAt?: number;
	resultSummary?: string;
	denialReason?: string;
}

export interface OrchestratorAgentStatusSummary {
	name: string;
	order: number;
	draftStatus: OrchestratorDraftStatus;
	agentJobId?: string;
	agentStatus?: AgentJobStatus;
	taskSummary: string;
	pendingApprovals: number;
	artifactCount: number;
	lastActivity?: number;
	hasFinalResponse: boolean;
}

export interface OrchestratorSessionSnapshot {
	session: OrchestratorSession;
	plan: string;
	drafts: OrchestratorWorkerDraft[];
	startRequests: OrchestratorStartRequest[];
	transcript: OrchestratorTranscriptEntry[];
}
