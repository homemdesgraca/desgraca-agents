import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AgentJob } from "../agents/agent-job.ts";
import type { OrchestratorSession, OrchestratorSessionSnapshot } from "../orchestrator/orchestrator-session.ts";
import { clampLine, formatTime, padLine, renderSectionTitle, wrapPlainLine } from "./render.ts";

function fg(theme: Theme | undefined, color: Parameters<Theme["fg"]>[0], text: string): string {
	return theme ? theme.fg(color, text) : text;
}

function bg(theme: Theme | undefined, color: Parameters<Theme["bg"]>[0], text: string): string {
	return theme ? theme.bg(color, text) : text;
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
	const lines: string[] = [renderSectionTitle("Orchestrator sessions", width, theme)];
	if (sessions.length === 0) lines.push(clampLine(fg(theme, "dim", "No sessions. Press C to create one."), width));
	else {
		for (const [index, session] of sessions.slice(0, 9).entries()) {
			const selected = session.id === selectedSessionId;
			const row = `${selected ? ">" : " "} ${index + 1}. ${session.title} [${session.status}]`;
			lines.push(selected ? bg(theme, "selectedBg", padLine(row, width)) : clampLine(fg(theme, selected ? "text" : "muted", row), width));
		}
	}
	lines.push("");
	const session = snapshot?.session;
	lines.push(renderSectionTitle("Active", width, theme));
	if (!session) lines.push(clampLine(fg(theme, "dim", "Select or create a session."), width));
	else {
		lines.push(clampLine(`Title: ${session.title}`, width));
		lines.push(clampLine(`Status: ${session.status}`, width));
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

export function renderOrchestratorRight(snapshot: OrchestratorSessionSnapshot | undefined, width: number, theme?: Theme): string[] {
	const lines: string[] = [renderSectionTitle("Orchestrator", width, theme)];
	if (!snapshot) return [...lines, clampLine(fg(theme, "dim", "No active session."), width)];
	lines.push(clampLine(`Session: ${snapshot.session.title}`, width));
	lines.push(clampLine(`Status: ${snapshot.session.status}  Updated: ${formatTime(snapshot.session.updatedAt)}`, width));
	lines.push("");
	lines.push(renderSectionTitle("Plan", width, theme));
	const planLines = snapshot.plan.trim() ? snapshot.plan.split("\n").flatMap((line) => wrapWords(line, width)).slice(0, 8) : [fg(theme, "dim", "No plan yet.")];
	lines.push(...planLines.map((line) => clampLine(line, width)));
	lines.push("");
	lines.push(renderSectionTitle("Start requests", width, theme));
	const pending = snapshot.startRequests.filter((request) => request.status === "pending");
	if (pending.length === 0) lines.push(clampLine(fg(theme, "dim", "No pending start requests."), width));
	else {
		for (const request of pending) {
			lines.push(clampLine(`${request.agentName} wait:${request.waitForResponse ? "yes" : "no"} created:${formatTime(request.createdAt)}`, width));
			lines.push(...wrapWords(request.message, Math.max(8, width - 2)).slice(0, 2).map((line) => clampLine(`  ${line}`, width)));
		}
	}
	lines.push("");
	lines.push(renderSectionTitle("Recent transcript", width, theme));
	const transcript = snapshot.transcript.slice(-12);
	if (transcript.length === 0) lines.push(clampLine(fg(theme, "dim", "No transcript yet. Press M to send a message."), width));
	else {
		for (const entry of transcript) {
			lines.push(clampLine(`${formatTime(entry.timestamp)} ${entry.kind} ${entry.title}`, width));
			if (entry.message) lines.push(...wrapWords(entry.message, Math.max(8, width - 2)).slice(0, 3).map((line) => clampLine(`  ${fg(theme, "toolOutput", line)}`, width)));
		}
	}
	return lines;
}
