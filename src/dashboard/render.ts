import * as fs from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentApproval, AgentArtifact, AgentJob } from "../agents/agent-job.ts";

export type DashboardMode = "normal" | "logs" | "approvals" | "artifacts" | "help";

type FgColor = Parameters<Theme["fg"]>[0];
type BgColor = Parameters<Theme["bg"]>[0];

const MODE_LABELS: Record<DashboardMode, string> = {
	normal: "AGENTS",
	logs: "TRACKING",
	approvals: "APPROVALS",
	artifacts: "ARTIFACTS",
	help: "HELP",
};

function fg(theme: Theme | undefined, color: FgColor, text: string): string {
	return theme ? theme.fg(color, text) : text;
}

function bg(theme: Theme | undefined, color: BgColor, text: string): string {
	return theme ? theme.bg(color, text) : text;
}

function bold(theme: Theme | undefined, text: string): string {
	return theme ? theme.bold(text) : text;
}

function normalizeLine(line: string): string {
	return line.replace(/[\r\n]+/g, " ");
}

export function clampLine(line: string, width: number): string {
	if (width <= 0) return "";
	return truncateToWidth(normalizeLine(line), width, "…", true);
}

export function padLine(line: string, width: number): string {
	const truncated = clampLine(line, width);
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function wrapPlainLine(line: string, width: number): string[] {
	if (width <= 0) return [""];
	if (line.length === 0) return [""];

	const chunks: string[] = [];
	let current = "";
	for (const char of Array.from(line.replace(/\t/g, "    "))) {
		if (visibleWidth(current + char) > width && current.length > 0) {
			chunks.push(current);
			current = char;
		} else {
			current += char;
		}
	}
	if (current.length > 0) chunks.push(current);
	return chunks.length > 0 ? chunks : [""];
}

function wrapWords(text: string, width: number): string[] {
	if (width <= 0) return [""];
	const words = text.split(/(\s+)/).filter((part) => part.length > 0);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (/^\s+$/.test(word)) {
			if (current && !current.endsWith(" ")) current += " ";
			continue;
		}
		const candidate = current ? `${current}${word}` : word;
		if (visibleWidth(candidate) <= width) {
			current = candidate;
			continue;
		}
		if (current) lines.push(current.trimEnd());
		if (visibleWidth(word) > width) {
			const hardWrapped = wrapPlainLine(word, width);
			lines.push(...hardWrapped.slice(0, -1));
			current = hardWrapped.at(-1) ?? "";
		} else {
			current = word;
		}
	}
	if (current) lines.push(current.trimEnd());
	return lines.length > 0 ? lines : [""];
}

function border(theme: Theme | undefined, text: string, accent = false): string {
	return fg(theme, accent ? "borderAccent" : "borderMuted", text);
}

export function renderDivider(width: number, theme?: Theme, left = "├", right = "┤"): string {
	if (width <= 1) return border(theme, "─".repeat(Math.max(0, width)));
	return border(theme, left + "─".repeat(Math.max(0, width - 2)) + right);
}

export function renderTopBorder(width: number, title: string, theme?: Theme): string {
	if (width <= 1) return border(theme, "─".repeat(Math.max(0, width)), true);
	const innerWidth = Math.max(0, width - 2);
	const renderedTitle = ` ${fg(theme, "warning", bold(theme, title))} `;
	const fill = Math.max(0, innerWidth - visibleWidth(renderedTitle));
	return border(theme, "╭", true) + renderedTitle + border(theme, "─".repeat(fill) + "╮", true);
}

export function renderBottomBorder(width: number, theme?: Theme): string {
	if (width <= 1) return border(theme, "─".repeat(Math.max(0, width)), true);
	return border(theme, "╰" + "─".repeat(Math.max(0, width - 2)) + "╯", true);
}

export function renderBoxedLine(line: string, width: number, theme?: Theme): string {
	if (width <= 1) return clampLine(line, width);
	const innerWidth = Math.max(0, width - 2);
	return border(theme, "│", true) + padLine(line, innerWidth) + border(theme, "│", true);
}

export function formatStatus(status: AgentJob["status"]): string {
	return status.toUpperCase();
}

export function formatStatusLabel(status: AgentJob["status"], theme?: Theme): string {
	const label = formatStatus(status);
	switch (status) {
		case "running":
			return fg(theme, "success", label);
		case "blocked":
			return fg(theme, "warning", label);
		case "failed":
			return fg(theme, "error", label);
		case "done":
			return fg(theme, "success", "FINISHED");
		case "aborted":
			return fg(theme, "muted", label);
		case "waiting":
			return fg(theme, "accent", label);
		case "draft":
		default:
			return fg(theme, "dim", label);
	}
}

export function formatTime(timestamp: number | undefined): string {
	if (!timestamp) return "-";
	return new Date(timestamp).toLocaleTimeString();
}

export function renderHeader(width: number, mode: DashboardMode, theme?: Theme, selected?: AgentJob): string[] {
	const modeText = fg(theme, "accent", bold(theme, MODE_LABELS[mode]));
	const title = `${fg(theme, "toolTitle", bold(theme, "desgraca-agents"))} ${fg(theme, "dim", "dashboard")}  ${fg(theme, "dim", "mode:")} ${modeText}`;
	const safety = fg(theme, "muted", "Isolated workspaces: .agents/{AGENT_NAME}. Generated work is never applied automatically.");
	const summary = selected
		? `${fg(theme, "dim", "selected:")} ${fg(theme, "text", selected.name)} ${fg(theme, "dim", "status:")} ${formatStatusLabel(selected.status, theme)} ${fg(theme, "dim", "artifacts:")} ${fg(theme, "accent", String(selected.artifacts.length))}`
		: fg(theme, "dim", "No selected agent. Press C to create a task-scoped worker.");
	return [padLine(title, width), padLine(safety, width), padLine(summary, width)];
}

export function renderModeTabs(active: DashboardMode, width: number, theme?: Theme): string[] {
	const tabs = (Object.keys(MODE_LABELS) as DashboardMode[]).map((mode) => {
		const label = ` ${MODE_LABELS[mode]} `;
		return mode === active ? bg(theme, "selectedBg", fg(theme, "text", label)) : fg(theme, "dim", label);
	});
	return packTokens(tabs, width, " ").map((line) => padLine(line, width));
}

export function renderJobList(jobs: AgentJob[], selectedId: string | undefined, width: number, theme?: Theme): string[] {
	if (jobs.length === 0) return [clampLine(fg(theme, "dim", "No agent jobs yet. Press C to create one."), width)];
	return jobs.map((job, index) => {
		const selected = job.id === selectedId;
		const pointer = selected ? fg(theme, "accent", ">") : fg(theme, "dim", " ");
		const number = fg(theme, selected ? "accent" : "dim", `${index + 1}.`);
		const approvalCount = job.pendingApprovals.filter((approval) => approval.status === "pending").length;
		const approvals = approvalCount > 0 ? ` ${fg(theme, "warning", `approvals:${approvalCount}`)}` : "";
		const artifacts = fg(theme, "dim", `artifacts:${job.artifacts.length}`);
		const row = `${pointer} ${number} ${fg(theme, selected ? "text" : "muted", job.name)} ${fg(theme, "dim", "[")}${formatStatusLabel(job.status, theme)}${fg(theme, "dim", "]")} ${artifacts}${approvals}`;
		return selected ? bg(theme, "selectedBg", padLine(row, width)) : clampLine(row, width);
	});
}

function renderField(label: string, value: string, width: number, theme?: Theme): string[] {
	const labelText = `${fg(theme, "dim", `${label}:`)} `;
	const labelWidth = visibleWidth(`${label}: `);
	const valueWidth = Math.max(8, width - labelWidth);
	const wrapped = value.split("\n").flatMap((line) => wrapWords(line || " ", valueWidth));
	return wrapped.map((line, index) => {
		const prefix = index === 0 ? labelText : " ".repeat(labelWidth);
		return clampLine(prefix + fg(theme, "text", line), width);
	});
}

function renderFinalResponse(job: AgentJob, width: number, theme?: Theme): string[] {
	const labelText = `${fg(theme, "dim", "Final Response:")} `;
	const labelWidth = visibleWidth("Final Response: ");
	const valueWidth = Math.max(8, width - labelWidth);
	if (!job.finalResponse?.trim()) return [clampLine(`${labelText}${fg(theme, "muted", "(not available yet)")}`, width)];

	const wrapped = job.finalResponse.split("\n").flatMap((line) => wrapWords(line || " ", valueWidth));
	const truncated = wrapped.length > 4;
	const visible = wrapped.slice(0, 4);
	if (truncated) visible[visible.length - 1] = "… check TRACKING for full output.";
	return visible.map((line, index) => {
		const prefix = index === 0 ? labelText : " ".repeat(labelWidth);
		return clampLine(prefix + fg(theme, "text", line), width);
	});
}

export function renderJobDetails(job: AgentJob | undefined, width: number, theme?: Theme): string[] {
	if (!job) return [clampLine(fg(theme, "dim", "Select or create an agent job."), width)];
	return [
		...renderField("Name", job.name, width, theme),
		clampLine(`${fg(theme, "dim", "Status:")} ${formatStatusLabel(job.status, theme)} ${fg(theme, "dim", "created")} ${fg(theme, "muted", formatTime(job.createdAt))} ${fg(theme, "dim", "updated")} ${fg(theme, "muted", formatTime(job.updatedAt))}`, width),
		...renderField("Readable root", job.readableRoot, width, theme),
		...renderField("Writable root", job.writableRoot, width, theme),
		...renderField("Allowed tools", job.allowedTools.join(", ") || "(none)", width, theme),
		...renderField("Model", job.model ? `${job.model.provider}/${job.model.id}` : "current pi default", width, theme),
		...renderField("Task", job.task || "(empty)", width, theme),
		...renderFinalResponse(job, width, theme),
		clampLine(`${fg(theme, "dim", "Process:")} ${fg(theme, "text", job.process?.pid ? `pid ${job.process.pid}` : "not running")}${job.process?.readOnly ? fg(theme, "warning", " | read-only runner") : ""}`, width),
	];
}

interface RenderLogsOptions {
	wrap?: boolean;
}

export function renderLogs(job: AgentJob | undefined, width: number, count = 12, theme?: Theme, options: RenderLogsOptions = {}): string[] {
	if (!job) return [clampLine(fg(theme, "dim", "No selected job."), width)];
	const logs = job.logs.slice(-count);
	if (logs.length === 0) return [clampLine(fg(theme, "dim", "No logs."), width)];
	return logs.flatMap((log) => {
		const messageLines = options.wrap ? log.message.split("\n") : log.message.split("\n").slice(0, 4);
		return messageLines.flatMap((line, index) => {
			const levelColor: FgColor = log.level === "error" ? "error" : log.level === "warning" ? "warning" : "muted";
			const stamp = index === 0 ? fg(theme, "dim", formatTime(log.timestamp)) : fg(theme, "dim", "        ");
			const prefix = `${stamp} ${fg(theme, levelColor, log.level)} `;
			if (!options.wrap) return [clampLine(`${prefix}${fg(theme, "toolOutput", line)}`, width)];
			const prefixWidth = visibleWidth(`${index === 0 ? formatTime(log.timestamp) : "        "} ${log.level} `);
			const messageWidth = Math.max(8, width - prefixWidth);
			const wrapped = wrapWords(line || " ", messageWidth);
			return wrapped.map((part, wrappedIndex) => {
				const wrappedPrefix = wrappedIndex === 0 ? prefix : " ".repeat(prefixWidth);
				return clampLine(`${wrappedPrefix}${fg(theme, "toolOutput", part)}`, width);
			});
		});
	});
}

export function renderTracking(job: AgentJob | undefined, width: number, theme?: Theme): string[] {
	if (!job) return [clampLine(fg(theme, "dim", "No selected job."), width)];
	if (!job.tracking || job.tracking.length === 0) return renderLogs(job, width, 18, theme, { wrap: true });
	return job.tracking.flatMap((entry) => {
		const kindColor: FgColor = entry.kind === "assistant" ? "success" : entry.kind === "user" ? "accent" : entry.kind === "tool" ? "toolTitle" : entry.kind === "error" ? "error" : "muted";
		const lines = [clampLine(`${fg(theme, "dim", formatTime(entry.timestamp))} ${fg(theme, kindColor, bold(theme, entry.title))}`, width)];
		if (entry.message) lines.push(...wrapWords(entry.message, Math.max(8, width - 2)).map((line) => clampLine(`  ${fg(theme, "toolOutput", line)}`, width)));
		if (entry.input) {
			lines.push(clampLine(`  ${fg(theme, "dim", "Input:")}`, width));
			lines.push(...entry.input.split("\n").flatMap((line) => wrapWords(line, Math.max(8, width - 4))).map((line) => clampLine(`    ${fg(theme, "muted", line)}`, width)));
		}
		if (entry.output) {
			lines.push(clampLine(`  ${fg(theme, "dim", "Output:")}`, width));
			lines.push(...entry.output.split("\n").flatMap((line) => wrapWords(line, Math.max(8, width - 4))).map((line) => clampLine(`    ${fg(theme, "toolOutput", line)}`, width)));
		}
		lines.push("");
		return lines;
	});
}

export function renderApprovals(job: AgentJob | undefined, width: number, theme?: Theme): string[] {
	if (!job) return [clampLine(fg(theme, "dim", "No selected job."), width)];
	const approvals = job.pendingApprovals.filter((approval) => approval.status === "pending");
	if (approvals.length === 0) return [clampLine(fg(theme, "dim", "No pending approvals."), width)];
	return approvals.flatMap((approval, index) => renderApproval(approval, index, width, theme));
}

function renderApproval(approval: AgentApproval, index: number, width: number, theme?: Theme): string[] {
	const warnings = approval.warnings.length > 0 ? ` ${fg(theme, "warning", approval.warnings.join(" | "))}` : "";
	return [
		clampLine(`${fg(theme, "accent", `${index + 1}.`)} ${fg(theme, "toolTitle", approval.toolName)} ${fg(theme, "dim", "for")} ${fg(theme, "text", approval.agentName)} ${fg(theme, "dim", `[${approval.status}]`)}`, width),
		clampLine(`   ${fg(theme, "muted", approval.inputSummary || "(empty input)")}`, width),
		clampLine(`   ${fg(theme, "dim", approval.reason)}${warnings}`, width),
	];
}

export function renderArtifacts(job: AgentJob | undefined, width: number, theme?: Theme): string[] {
	if (!job) return [clampLine(fg(theme, "dim", "No selected job."), width)];
	if (job.artifacts.length === 0) return [clampLine(fg(theme, "dim", "No artifacts found under the job workspace."), width)];
	return job.artifacts.map((artifact, index) => formatArtifact(artifact, index, width, theme));
}

function formatArtifact(artifact: AgentArtifact, index: number, width: number, theme?: Theme): string {
	return clampLine(`${fg(theme, "accent", `${index + 1}.`)} ${fg(theme, "text", artifact.path)} ${fg(theme, "dim", `(${artifact.sizeBytes} bytes)`)}`, width);
}

export function renderArtifactContent(artifact: AgentArtifact | undefined, width: number, maxLines = 18, theme?: Theme): string[] {
	if (!artifact) return [];
	let content: string;
	try {
		content = fs.readFileSync(artifact.absolutePath, "utf8");
	} catch (error) {
		return [clampLine(fg(theme, "error", `Could not read artifact: ${error instanceof Error ? error.message : String(error)}`), width)];
	}
	const rawLines = content.split("\n");
	const lines = rawLines.slice(0, maxLines);
	const output = [clampLine(`${fg(theme, "dim", "---")} ${fg(theme, "accent", artifact.path)}`, width), ...lines.map((line) => clampLine(fg(theme, "toolOutput", line), width))];
	if (rawLines.length > maxLines) output.push(clampLine(fg(theme, "muted", "... truncated in dashboard view"), width));
	return output;
}

function key(theme: Theme | undefined, value: string): string {
	return fg(theme, "accent", bold(theme, value));
}

function packTokens(tokens: string[], width: number, separator = "  "): string[] {
	if (width <= 0) return [""];
	const lines: string[] = [];
	let current = "";
	for (const token of tokens) {
		const candidate = current ? `${current}${separator}${token}` : token;
		if (visibleWidth(candidate) <= width) {
			current = candidate;
			continue;
		}
		if (current) lines.push(current);
		if (visibleWidth(token) > width) lines.push(...wrapPlainLine(token, width));
		else current = token;
	}
	if (current) lines.push(current);
	return lines.length > 0 ? lines : [""];
}

export function renderFooterHints(width: number, theme?: Theme): string[] {
	const hints = [
		`${key(theme, "C")} create`,
		`${key(theme, "1-9")} select`,
		`${key(theme, "S")} start`,
		`${key(theme, "X")} abort`,
		`${key(theme, "A/N")} approve/deny`,
		`${key(theme, "Del")} delete`,
		`${key(theme, "↑/↓")} scroll`,
		`${key(theme, "M")} message`,
		`${key(theme, "L/P/D")} modes`,
		`${key(theme, "R")} refresh`,
		`${key(theme, "H")} help`,
		`${key(theme, "Q/Esc")} close`,
	];
	return packTokens(hints, width).map((line) => padLine(line, width));
}

export function renderHelp(width: number, theme?: Theme): string[] {
	const heading = (text: string) => fg(theme, "toolTitle", bold(theme, text));
	const lines = [
		heading("Navigation"),
		`${key(theme, "1-9")} select an agent job from the left pane. The selected job drives every detail view and action.`,
		`${key(theme, "↑/↓")} scroll the right-hand panel when its content is longer than the visible dashboard area.`,
		`${key(theme, "Enter")} returns to agents mode. ${key(theme, "Q/Esc")} closes the dashboard.`,
		"",
		heading("Job actions"),
		`${key(theme, "C")} create a task-scoped agent job. Opens an empty overlay for the worker name, model, and task; cancelling returns to this dashboard without creating anything.`,
		`${key(theme, "S")} start the selected job in its isolated workspace. ${key(theme, "X")} aborts the selected job if it is running. ${key(theme, "M")} sends a follow-up message from TRACKING.`,
		`${key(theme, "Del/Backspace")} deletes the selected agent job after confirmation and removes its .agents workspace.`,
		`${key(theme, "A")} approves the first pending approval for the selected agent. ${key(theme, "N")} denies it.`,
		`${key(theme, "R")} refreshes artifact discovery for the selected agent.`,
		"",
		heading("Dashboard modes"),
		`${key(theme, "Agents mode")} shows the selected agent's identity, status, readable root, writable root, allowed tools, model, task, final response preview, process state, and recent logs.`,
		`${key(theme, "Tracking mode")} shows a readable timeline of user messages, worker responses, status changes, and detailed tool activity. Use ${key(theme, "M")} to keep talking to a finished worker.`,
		`${key(theme, "Approvals mode")} shows pending sensitive tool requests for the selected agent, including tool name, input summary, policy reason, and simple risk warnings.`,
		`${key(theme, "Artifacts mode")} lists files discovered under the selected agent's .agents workspace. Press ${key(theme, "1-9")} in this mode to preview an artifact without applying it to the project.`,
		`${key(theme, "Help mode")} is this reference view with grouped navigation, job actions, and mode descriptions.`,
	];
	return lines.flatMap((line) => (line === "" ? [""] : wrapWords(line, width))).map((line) => clampLine(line, width));
}

export function renderSectionTitle(title: string, width: number, theme?: Theme): string {
	const rendered = ` ${fg(theme, "toolTitle", bold(theme, title))} `;
	const fill = Math.max(0, width - visibleWidth(rendered));
	return clampLine(rendered + fg(theme, "borderMuted", "─".repeat(fill)), width);
}

export function splitColumns(left: string[], right: string[], width: number, theme?: Theme): string[] {
	const gap = ` ${border(theme, "│")} `;
	const leftWidth = Math.max(24, Math.floor(width * 0.38));
	const rightWidth = Math.max(10, width - leftWidth - visibleWidth(gap));
	const rows = Math.max(left.length, right.length);
	const lines: string[] = [];
	for (let i = 0; i < rows; i++) {
		lines.push(clampLine(`${padLine(left[i] ?? "", leftWidth)}${gap}${padLine(right[i] ?? "", rightWidth)}`, width));
	}
	return lines;
}
