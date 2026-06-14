import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AgentJob } from "../agents/agent-job.ts";
import type { OrchestratorSession, OrchestratorSessionSnapshot, OrchestratorTranscriptEntry } from "../orchestrator/orchestrator-session.ts";
import { clampLine, formatTime, padLine, renderSectionTitle, shouldHideToolDetails, wrapPlainLine } from "./render.ts";

function fg(theme: Theme | undefined, color: Parameters<Theme["fg"]>[0], text: string): string {
	return theme ? theme.fg(color, text) : text;
}

function bg(theme: Theme | undefined, color: Parameters<Theme["bg"]>[0], text: string): string {
	return theme ? theme.bg(color, text) : text;
}

function bold(theme: Theme | undefined, text: string): string {
	return theme ? theme.bold(text) : text;
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
		if (candidate.length <= width) current = candidate;
		else {
			if (current) lines.push(current.trimEnd());
			if (word.length > width) {
				const parts = wrapPlainLine(word, width);
				lines.push(...parts.slice(0, -1));
				current = parts.at(-1) ?? "";
			} else current = word;
		}
	}
	if (current) lines.push(current.trimEnd());
	return lines.length ? lines : [""];
}

function modelLabel(session: OrchestratorSession | undefined): string {
	return session?.model ? `${session.model.provider}/${session.model.id}` : "current/default";
}

function jobById(jobs: AgentJob[], id: string | undefined): AgentJob | undefined {
	return id ? jobs.find((job) => job.id === id) : undefined;
}

export function renderOrchestratorLeft(
	sessions: OrchestratorSession[],
	selectedSessionId: string | undefined,
	snapshot: OrchestratorSessionSnapshot | undefined,
	jobs: AgentJob[],
	width: number,
	theme?: Theme,
): string[] {
	const lines: string[] = [renderSectionTitle("Orchestrator threads", width, theme)];
	if (sessions.length === 0) lines.push(clampLine(fg(theme, "dim", "No orchestrators. Press C to create one."), width));
	else {
		const selectedSession = sessions.find((session) => session.id === selectedSessionId);
		let lastOrchestratorId = "";
		for (const [index, session] of sessions.slice(0, 9).entries()) {
			const orchestratorId = session.orchestratorId ?? session.id;
			if (orchestratorId !== lastOrchestratorId) {
				const title = session.orchestratorTitle ?? session.title;
				const selectedGroup = (selectedSession?.orchestratorId ?? selectedSession?.id) === orchestratorId;
				lines.push(clampLine(fg(theme, selectedGroup ? "accent" : "toolTitle", title), width));
				lastOrchestratorId = orchestratorId;
			}
			const selected = session.id === selectedSessionId;
			const thread = session.threadTitle ?? (session.orchestratorId === session.id ? "Main" : session.title);
			const row = `${selected ? ">" : " "} ${index + 1}. ${thread} [${session.status}]`;
			lines.push(selected ? bg(theme, "selectedBg", padLine(row, width)) : clampLine(fg(theme, selected ? "text" : "muted", row), width));
		}
	}
	lines.push("");
	const session = snapshot?.session;
	lines.push(renderSectionTitle("Active", width, theme));
	if (!session) lines.push(clampLine(fg(theme, "dim", "Select or create a session."), width));
	else {
		const pendingStarts = snapshot?.startRequests.filter((request) => request.status === "pending") ?? [];
		lines.push(clampLine(`Title: ${session.title}`, width));
		lines.push(clampLine(`Status: ${session.status}`, width));
		if (pendingStarts.length > 0) lines.push(clampLine(fg(theme, "warning", `Action required: ${pendingStarts.length} pending start request${pendingStarts.length === 1 ? "" : "s"}`), width));
		lines.push(clampLine(`Model: ${modelLabel(session)}`, width));
		if (session.waitingFor) lines.push(clampLine(`Waiting: ${session.waitingFor.kind} ${session.waitingFor.agentName ?? session.waitingFor.requestId ?? ""}`, width));
	}
	lines.push("");
	lines.push(renderSectionTitle("Drafted workers", width, theme));
	const drafts = snapshot?.drafts ?? [];
	if (drafts.length === 0) lines.push(clampLine(fg(theme, "dim", "No drafts yet."), width));
	else {
		for (const draft of drafts) {
			const job = jobById(jobs, draft.agentJobId);
			const status = job?.status ?? draft.status;
			lines.push(clampLine(`${draft.order}. ${draft.name} [${status}]`, width));
			lines.push(...wrapWords(draft.task, Math.max(8, width - 2)).slice(0, 2).map((line) => clampLine(`  ${fg(theme, "muted", line)}`, width)));
		}
	}
	return lines;
}

function transcriptKindColor(entry: OrchestratorTranscriptEntry): Parameters<Theme["fg"]>[0] {
	if (entry.kind === "assistant") return "success";
	if (entry.kind === "user") return "accent";
	if (entry.kind === "tool") return "toolTitle";
	if (entry.kind === "error") return "error";
	return "muted";
}

function renderTranscriptEntry(entry: OrchestratorTranscriptEntry, width: number, theme?: Theme): string[] {
	const lines = [clampLine(`${fg(theme, "dim", formatTime(entry.timestamp))} ${fg(theme, transcriptKindColor(entry), bold(theme, entry.title))}`, width)];
	const hideToolDetails = entry.kind === "tool" && shouldHideToolDetails(entry.toolName ?? entry.title);
	if (entry.message) lines.push(...entry.message.split("\n").flatMap((line) => wrapWords(hideToolDetails ? `${line || " "} (details hidden)` : line || " ", Math.max(8, width - 2))).map((line) => clampLine(`  ${fg(theme, "toolOutput", line)}`, width)));
	if (!hideToolDetails && entry.input) {
		lines.push(clampLine(`  ${fg(theme, "dim", "Input:")}`, width));
		lines.push(...entry.input.split("\n").flatMap((line) => wrapWords(line || " ", Math.max(8, width - 4))).map((line) => clampLine(`    ${fg(theme, "muted", line)}`, width)));
	}
	if (!hideToolDetails && entry.output) {
		lines.push(clampLine(`  ${fg(theme, "dim", "Output:")}`, width));
		lines.push(...entry.output.split("\n").flatMap((line) => wrapWords(line || " ", Math.max(8, width - 4))).map((line) => clampLine(`    ${fg(theme, "toolOutput", line)}`, width)));
	}
	lines.push("");
	return lines;
}

export function renderOrchestratorRight(snapshot: OrchestratorSessionSnapshot | undefined, width: number, theme?: Theme): string[] {
	const lines: string[] = [renderSectionTitle("Orchestrator", width, theme)];
	if (!snapshot) return [...lines, clampLine(fg(theme, "dim", "No active session."), width)];
	const pending = snapshot.startRequests.filter((request) => request.status === "pending");
	lines.push(clampLine(`Session: ${snapshot.session.title}`, width));
	lines.push(clampLine(`Status: ${snapshot.session.status}  Updated: ${formatTime(snapshot.session.updatedAt)}`, width));
	if (pending.length > 0) {
		lines.push(clampLine(fg(theme, "warning", bold(theme, `ACTION REQUIRED: ${pending.length} pending orchestrator start request${pending.length === 1 ? "" : "s"}.`)), width));
		lines.push(clampLine(fg(theme, "warning", "Press S/Enter to review and approve, or N to review and deny."), width));
	}
	if (snapshot.session.waitingFor) lines.push(clampLine(`Waiting: ${snapshot.session.waitingFor.kind} ${snapshot.session.waitingFor.agentName ?? snapshot.session.waitingFor.requestId ?? ""}`, width));
	lines.push("");
	lines.push(renderSectionTitle("Plan summary", width, theme));
	const planLines = snapshot.plan.trim() ? snapshot.plan.split("\n").flatMap((line) => wrapWords(line, width)).slice(0, 4) : [fg(theme, "dim", "No plan yet.")];
	lines.push(...planLines.map((line) => clampLine(line, width)));
	lines.push("");
	lines.push(renderSectionTitle(pending.length > 0 ? "Pending starts - ACTION REQUIRED" : "Pending starts", width, theme));
	if (pending.length === 0) lines.push(clampLine(fg(theme, "dim", "No pending start requests."), width));
	else {
		for (const request of pending) {
			const target = request.kind === "order" || request.order !== undefined ? `order:${request.order ?? "?"} ${request.agentNames?.length ? `agents:${request.agentNames.length}` : ""}` : request.agentName;
			lines.push(clampLine(fg(theme, "warning", `${target} wait:${request.waitForResponse ? "yes" : "no"} created:${formatTime(request.createdAt)}`), width));
			lines.push(...wrapWords(request.message, Math.max(8, width - 2)).slice(0, 2).map((line) => clampLine(`  ${line}`, width)));
		}
	}
	lines.push("");
	lines.push(renderSectionTitle("Transcript", width, theme));
	if (snapshot.transcript.length === 0) lines.push(clampLine(fg(theme, "dim", "No transcript yet. Press M to send a message."), width));
	else lines.push(...snapshot.transcript.flatMap((entry) => renderTranscriptEntry(entry, width, theme)));
	return lines;
}
