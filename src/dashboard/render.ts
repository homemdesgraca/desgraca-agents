import * as fs from "node:fs";
import type { AgentApproval, AgentArtifact, AgentJob } from "../agents/agent-job.ts";

export type DashboardMode = "normal" | "logs" | "approvals" | "artifacts" | "help";

export function clampLine(line: string, width: number): string {
	if (width <= 0) return "";
	const clean = line.replace(/[\r\n]+/g, " ");
	return clean.length > width ? clean.slice(0, Math.max(0, width - 1)) + "…" : clean.padEnd(Math.min(width, clean.length));
}

export function formatStatus(status: AgentJob["status"]): string {
	return status.toUpperCase();
}

export function formatTime(timestamp: number | undefined): string {
	if (!timestamp) return "-";
	return new Date(timestamp).toLocaleTimeString();
}

export function renderHeader(width: number, mode: DashboardMode): string[] {
	return [
		clampLine(`desgraca-agents dashboard | mode: ${mode}`, width),
		clampLine("Agents are isolated under .agents/{AGENT_NAME}; generated work is never applied automatically.", width),
	];
}

export function renderJobList(jobs: AgentJob[], selectedId: string | undefined, width: number): string[] {
	if (jobs.length === 0) return [clampLine("No agent jobs yet. Press C to create one.", width)];
	return jobs.map((job, index) => {
		const prefix = job.id === selectedId ? ">" : " ";
		const approvalCount = job.pendingApprovals.filter((approval) => approval.status === "pending").length;
		const approvals = approvalCount > 0 ? ` approvals:${approvalCount}` : "";
		return clampLine(`${prefix} ${index + 1}. ${job.name} [${formatStatus(job.status)}] artifacts:${job.artifacts.length}${approvals}`, width);
	});
}

export function renderJobDetails(job: AgentJob | undefined, width: number): string[] {
	if (!job) return [clampLine("Select or create an agent job.", width)];
	return [
		clampLine(`Name: ${job.name}`, width),
		clampLine(`Status: ${formatStatus(job.status)} | created ${formatTime(job.createdAt)} | updated ${formatTime(job.updatedAt)}`, width),
		clampLine(`Readable root: ${job.readableRoot}`, width),
		clampLine(`Writable root: ${job.writableRoot}`, width),
		clampLine(`Allowed tools: ${job.allowedTools.join(", ") || "(none)"}`, width),
		clampLine(`Task: ${job.task || "(empty)"}`, width),
		clampLine(`Process: ${job.process?.pid ? `pid ${job.process.pid}` : "not running"}${job.process?.readOnly ? " | read-only runner" : ""}`, width),
	];
}

export function renderLogs(job: AgentJob | undefined, width: number, count = 12): string[] {
	if (!job) return [clampLine("No selected job.", width)];
	const logs = job.logs.slice(-count);
	if (logs.length === 0) return [clampLine("No logs.", width)];
	return logs.flatMap((log) =>
		log.message.split("\n").slice(0, 4).map((line, index) => clampLine(`${index === 0 ? formatTime(log.timestamp) : "        "} ${log.level}: ${line}`, width)),
	);
}

export function renderApprovals(job: AgentJob | undefined, width: number): string[] {
	if (!job) return [clampLine("No selected job.", width)];
	const approvals = job.pendingApprovals.filter((approval) => approval.status === "pending");
	if (approvals.length === 0) return [clampLine("No pending approvals.", width)];
	return approvals.flatMap((approval, index) => renderApproval(approval, index, width));
}

function renderApproval(approval: AgentApproval, index: number, width: number): string[] {
	const warnings = approval.warnings.length > 0 ? ` | ${approval.warnings.join(" | ")}` : "";
	return [
		clampLine(`${index + 1}. ${approval.toolName} for ${approval.agentName} [${approval.status}]`, width),
		clampLine(`   ${approval.inputSummary}`, width),
		clampLine(`   ${approval.reason}${warnings}`, width),
	];
}

export function renderArtifacts(job: AgentJob | undefined, width: number): string[] {
	if (!job) return [clampLine("No selected job.", width)];
	if (job.artifacts.length === 0) return [clampLine("No artifacts found under the job workspace.", width)];
	return job.artifacts.map((artifact, index) => formatArtifact(artifact, index, width));
}

function formatArtifact(artifact: AgentArtifact, index: number, width: number): string {
	return clampLine(`${index + 1}. ${artifact.path} (${artifact.sizeBytes} bytes)`, width);
}

export function renderArtifactContent(artifact: AgentArtifact | undefined, width: number, maxLines = 18): string[] {
	if (!artifact) return [];
	let content: string;
	try {
		content = fs.readFileSync(artifact.absolutePath, "utf8");
	} catch (error) {
		return [clampLine(`Could not read artifact: ${error instanceof Error ? error.message : String(error)}`, width)];
	}
	const lines = content.split("\n").slice(0, maxLines);
	const output = [clampLine(`--- ${artifact.path}`, width), ...lines.map((line) => clampLine(line, width))];
	if (content.split("\n").length > maxLines) output.push(clampLine("... truncated in dashboard view", width));
	return output;
}

export function renderHelp(width: number): string[] {
	return [
		"Q/Esc close | C create | 1-9 select agent | S start | X abort | R refresh artifacts",
		"A approve first pending approval | N deny first pending approval",
		"L logs mode | P approvals mode | D artifact mode | H help | Enter normal mode",
		"In artifact mode, press 1-9 to preview an artifact for the selected agent.",
	].map((line) => clampLine(line, width));
}

export function splitColumns(left: string[], right: string[], width: number): string[] {
	const gap = " │ ";
	const leftWidth = Math.max(24, Math.floor(width * 0.38));
	const rightWidth = Math.max(10, width - leftWidth - gap.length);
	const rows = Math.max(left.length, right.length);
	const lines: string[] = [];
	for (let i = 0; i < rows; i++) {
		lines.push(`${clampLine(left[i] ?? "", leftWidth)}${gap}${clampLine(right[i] ?? "", rightWidth)}`.slice(0, width));
	}
	return lines;
}
