import * as path from "node:path";
import { randomUUID } from "node:crypto";

export type AgentJobStatus = "draft" | "waiting" | "running" | "blocked" | "done" | "failed" | "aborted";

export interface AgentLogEntry {
	id: string;
	timestamp: number;
	level: "info" | "warning" | "error" | "debug";
	message: string;
}

export type AgentTrackingEntryKind = "user" | "assistant" | "tool" | "status" | "error";

export interface AgentTrackingEntry {
	id: string;
	timestamp: number;
	kind: AgentTrackingEntryKind;
	title: string;
	message?: string;
	toolName?: string;
	input?: string;
	output?: string;
}

export interface AgentApproval {
	id: string;
	agentId: string;
	agentName: string;
	toolName: string;
	inputSummary: string;
	warnings: string[];
	reason: string;
	status: "pending" | "approved" | "denied";
	createdAt: number;
	resolvedAt?: number;
}

export interface AgentArtifactSuggestion {
	id: string;
	artifactPath: string;
	path: string;
	absolutePath: string;
	sizeBytes: number;
	updatedAt: number;
	createdAt: number;
	orchestratorSessionId: string;
	orchestratorTitle?: string;
	summary?: string;
}

export interface AgentArtifact {
	id: string;
	agentId: string;
	path: string;
	absolutePath: string;
	sizeBytes: number;
	updatedAt: number;
	kind?: "artifact" | "proposal" | "note";
	originalPath?: string;
	suggestions?: AgentArtifactSuggestion[];
}

export interface AgentModelSelection {
	provider: string;
	id: string;
	label?: string;
}

export interface AgentProcessMetadata {
	pid?: number;
	command?: string;
	args?: string[];
	startedAt?: number;
	exitedAt?: number;
	exitCode?: number | null;
	signal?: string | null;
	readOnly?: boolean;
}

export interface AgentJobSourceMetadata {
	kind: "orchestrator";
	sessionId: string;
	draftId: string;
	order: number;
}

export interface AgentJob {
	id: string;
	name: string;
	task: string;
	finalResponse?: string;
	model?: AgentModelSelection;
	status: AgentJobStatus;
	allowedTools: string[];
	readableRoot: string;
	writableRoot: string;
	logs: AgentLogEntry[];
	tracking: AgentTrackingEntry[];
	pendingApprovals: AgentApproval[];
	artifacts: AgentArtifact[];
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	finishedAt?: number;
	process?: AgentProcessMetadata;
	source?: AgentJobSourceMetadata;
	userEditedAt?: number;
}

export function createId(): string {
	return randomUUID();
}

export function sanitizeAgentName(name: string): string {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return normalized || `agent-${Date.now()}`;
}

export function getAgentsRoot(cwd: string): string {
	return path.resolve(cwd, ".agents");
}

export function getAgentWritableRoot(cwd: string, agentName: string): string {
	return path.join(getAgentsRoot(cwd), sanitizeAgentName(agentName));
}

export function createAgentJob(cwd: string, name: string, task: string, model?: AgentModelSelection): AgentJob {
	const now = Date.now();
	const safeName = sanitizeAgentName(name);
	return {
		id: createId(),
		name: safeName,
		task: task.trim(),
		model,
		status: "draft",
		allowedTools: ["read", "grep", "find", "ls", "bash", "agent_write_proposal", "agent_edit_proposal", "agent_view_artifacts", "agent_create_note", "agent_edit_note", "agent_view_notes"],
		readableRoot: path.resolve(cwd),
		writableRoot: getAgentWritableRoot(cwd, safeName),
		logs: [
			{
				id: createId(),
				timestamp: now,
				level: "info",
				message: "Job created.",
			},
		],
		tracking: [
			{
				id: createId(),
				timestamp: now,
				kind: "status",
				title: "Job created",
				message: "Waiting for the user to start this worker.",
			},
		],
		pendingApprovals: [],
		artifacts: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function touchJob<T extends AgentJob>(job: T): T {
	return { ...job, updatedAt: Date.now() };
}
