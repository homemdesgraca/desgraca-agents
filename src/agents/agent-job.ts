import * as path from "node:path";
import { randomUUID } from "node:crypto";

export type AgentJobStatus = "draft" | "waiting" | "running" | "blocked" | "done" | "failed" | "aborted";

export interface AgentLogEntry {
	id: string;
	timestamp: number;
	level: "info" | "warning" | "error" | "debug";
	message: string;
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

export interface AgentArtifact {
	id: string;
	agentId: string;
	path: string;
	absolutePath: string;
	sizeBytes: number;
	updatedAt: number;
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

export interface AgentJob {
	id: string;
	name: string;
	task: string;
	finalResponse?: string;
	status: AgentJobStatus;
	allowedTools: string[];
	readableRoot: string;
	writableRoot: string;
	logs: AgentLogEntry[];
	pendingApprovals: AgentApproval[];
	artifacts: AgentArtifact[];
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	finishedAt?: number;
	process?: AgentProcessMetadata;
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

export function createAgentJob(cwd: string, name: string, task: string): AgentJob {
	const now = Date.now();
	const safeName = sanitizeAgentName(name);
	return {
		id: createId(),
		name: safeName,
		task: task.trim(),
		status: "draft",
		allowedTools: ["read", "grep", "find", "ls"],
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
		pendingApprovals: [],
		artifacts: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function touchJob<T extends AgentJob>(job: T): T {
	return { ...job, updatedAt: Date.now() };
}
