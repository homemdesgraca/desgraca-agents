import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { AgentStore } from "../agents/agent-store.ts";
import { createArtifactSuggestion } from "../agents/artifact-suggestions.ts";
import { discoverArtifacts } from "../agents/agent-runner.ts";
import { sanitizeAgentName } from "../agents/agent-job.ts";
import { isPathInside } from "../permissions/scope-guard.ts";
import { createDefaultSettings, normalizeAgentExtensionSettings } from "../settings/settings.ts";
import { getOrchestratorProcessEnvContext } from "./orchestrator-env.ts";
import { OrchestratorStore } from "./orchestrator-store.ts";
import type { OrchestratorStartRequest } from "./orchestrator-session.ts";

const POLL_INTERVAL_MS = 1000;
const MAX_NOTE_BYTES = 48_000;

function toolText(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function truncateText(content: string, maxBytes = MAX_NOTE_BYTES): string {
	if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
	return `${content.slice(0, maxBytes)}\n... truncated`;
}

function getContextOrThrow() {
	const context = getOrchestratorProcessEnvContext();
	if (!context) throw new Error("This tool is only available inside a marked desgraca-agents orchestrator process.");
	return context;
}

async function createStores() {
	const context = getContextOrThrow();
	const settings = normalizeAgentExtensionSettings(context.settings ?? createDefaultSettings());
	const agentStore = new AgentStore();
	await agentStore.loadFromDisk(context.cwd);
	const orchestratorStore = new OrchestratorStore(agentStore);
	await orchestratorStore.loadFromDisk(context.cwd);
	orchestratorStore.select(context.sessionId);
	return { context, settings, agentStore, orchestratorStore };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		if (signal) {
			signal.addEventListener("abort", () => {
				clearTimeout(timer);
				reject(new Error("Orchestrator wait aborted."));
			}, { once: true });
		}
	});
}

function terminalStatus(status: string | undefined): boolean {
	return status === "done" || status === "failed" || status === "aborted";
}

async function waitForStartRequest(request: OrchestratorStartRequest, signal?: AbortSignal): Promise<string> {
	const { context, agentStore, orchestratorStore } = await createStores();
	while (true) {
		await agentStore.reloadFromDisk(context.cwd);
		await orchestratorStore.loadFromDisk(context.cwd);
		const requests = await orchestratorStore.listStartRequests(request.sessionId);
		const latest = requests.find((item) => item.id === request.id);
		if (!latest) throw new Error(`Start request disappeared: ${request.id}`);
		if (latest.status === "denied") return `Start request denied: ${latest.denialReason ?? "Denied by user."}`;
		if (["done", "failed", "aborted"].includes(latest.status)) return `Agent ${latest.agentName} finished with request status ${latest.status}. ${latest.resultSummary ?? ""}`.trim();
		if (latest.agentJobId) {
			const job = agentStore.get(latest.agentJobId);
			if (terminalStatus(job?.status)) {
				await orchestratorStore.refreshStartRequestsFromJobs();
				return `Agent ${latest.agentName} finished with status ${job?.status}. ${job?.finalResponse ? truncateText(job.finalResponse, 4000) : ""}`.trim();
			}
		}
		await sleep(POLL_INTERVAL_MS, signal);
	}
}

async function waitForAgentDetails(name: string, signal?: AbortSignal): Promise<string> {
	const safeName = sanitizeAgentName(name);
	const { context, agentStore, orchestratorStore } = await createStores();
	while (true) {
		await agentStore.reloadFromDisk(context.cwd);
		await orchestratorStore.loadFromDisk(context.cwd);
		const session = orchestratorStore.get(context.sessionId);
		if (!session) throw new Error(`Unknown orchestrator session: ${context.sessionId}`);
		const drafts = await orchestratorStore.listDrafts(context.sessionId);
		const draft = drafts.find((item) => sanitizeAgentName(item.name) === safeName);
		const job = draft?.agentJobId ? agentStore.get(draft.agentJobId) : agentStore.list().find((item) => sanitizeAgentName(item.name) === safeName);
		if (!job || terminalStatus(job.status)) return formatAgentDetails(draft, job);
		await sleep(POLL_INTERVAL_MS, signal);
	}
}

function formatAgentDetails(draft: any, job: any): string {
	if (!draft && !job) return "No matching draft or agent found.";
	const pendingApprovals = job?.pendingApprovals?.filter?.((approval: any) => approval.status === "pending") ?? [];
	const artifacts = job?.artifacts ?? [];
	const artifactLines = artifacts.slice(0, 12).map((artifact: any) => `- ${artifact.path}${artifact.originalPath ? ` (original: ${artifact.originalPath})` : ""}${artifact.suggestions?.length ? ` suggestions:${artifact.suggestions.length}` : ""}`).join("\n");
	const logs = (job?.logs ?? []).slice(-6).map((log: any) => `${new Date(log.timestamp).toLocaleTimeString()} ${log.level}: ${log.message}`).join("\n");
	const tracking = (job?.tracking ?? []).slice(-6).map((entry: any) => `${new Date(entry.timestamp).toLocaleTimeString()} ${entry.title}: ${entry.message ?? ""}`).join("\n");
	return [
		`Name: ${job?.name ?? draft?.name}`,
		`Order: ${draft?.order ?? job?.source?.order ?? "-"}`,
		`Draft status: ${draft?.status ?? "-"}`,
		`Agent status: ${job?.status ?? "not created"}`,
		`Task: ${job?.task ?? draft?.task ?? ""}`,
		`Pending approvals: ${pendingApprovals.length}`,
		`Artifacts: ${artifacts.length}`,
		artifactLines ? `Artifact paths for suggestions/review:\n${artifactLines}` : "Artifact paths for suggestions/review: (none)",
		job?.finalResponse ? `Final response:\n${truncateText(job.finalResponse, 8000)}` : "Final response: (not available)",
		logs ? `Recent logs:\n${logs}` : "Recent logs: (none)",
		tracking ? `Recent tracking:\n${tracking}` : "Recent tracking: (none)",
	].join("\n");
}

function noteFileName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) throw new Error("Note names must be plain names.");
	const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 100);
	if (!sanitized || sanitized === "." || sanitized === "..") throw new Error("Note name is invalid after sanitization.");
	return /\.(md|txt)$/i.test(sanitized) ? sanitized : `${sanitized}.md`;
}

function resolveNotePath(root: string, name: string): { root: string; fileName: string; absolutePath: string } {
	const notesRoot = path.resolve(root, "notes");
	const fileName = noteFileName(name);
	const absolutePath = path.resolve(notesRoot, fileName);
	if (!isPathInside(notesRoot, absolutePath)) throw new Error("Note path resolved outside the orchestrator notes directory.");
	return { root: notesRoot, fileName, absolutePath };
}

export function registerOrchestratorTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "orchestrator_update_plan",
		label: "Orchestrator Update Plan",
		description: "Replace the current orchestrator session plan.",
		promptSnippet: "Update the high-level orchestration plan",
		promptGuidelines: ["Use this to store the current high-level plan for the user's review.", "Do not use it for project-file changes."],
		parameters: Type.Object({ content: Type.String({ description: "Full markdown plan content." }) }),
		async execute(_toolCallId, params) {
			const { context, orchestratorStore } = await createStores();
			await orchestratorStore.writePlan(context.sessionId, params.content);
			return toolText("Updated orchestrator plan.", { sessionId: context.sessionId });
		},
	});

	pi.registerTool({
		name: "orchestrator_create_agent_draft",
		label: "Orchestrator Create Agent Draft",
		description: "Create or update an ordered worker draft with only name, task, and order.",
		promptSnippet: "Create or update a worker draft",
		promptGuidelines: ["Only provide worker name, task, and order.", "Do not include model or permission profile; the user controls those in AGENTS mode."],
		parameters: Type.Object({
			name: Type.String({ description: "Worker name." }),
			task: Type.String({ description: "Worker task." }),
			order: Type.Number({ description: "Positive numeric run order." }),
		}),
		async execute(_toolCallId, params) {
			const { context, settings, orchestratorStore } = await createStores();
			const result = await orchestratorStore.createOrUpdateDraft(context.sessionId, params, settings);
			const text = [`Draft ${result.draft.order}. ${result.draft.name} saved.`, `Linked agent job: ${result.job?.id ?? "none"}.`, result.warning ? `Warning: ${result.warning}` : ""].filter(Boolean).join("\n");
			return toolText(text, result as unknown as Record<string, unknown>);
		},
	});

	pi.registerTool({
		name: "orchestrator_request_start_agent",
		label: "Orchestrator Request Start Agent",
		description: "Ask the user to start a drafted agent, optionally waiting for the response.",
		promptSnippet: "Request user approval to start an agent",
		promptGuidelines: ["This creates a user-mediated start request; it does not directly start the worker.", "Set waitForResponse when later steps depend on this worker's result."],
		parameters: Type.Object({
			name: Type.String({ description: "Worker name." }),
			waitForResponse: Type.Optional(Type.Boolean({ description: "Whether to wait for denial or terminal worker result." })),
		}),
		async execute(_toolCallId, params, signal) {
			const { context, orchestratorStore } = await createStores();
			const request = await orchestratorStore.createStartRequest(context.sessionId, { name: params.name, waitForResponse: params.waitForResponse });
			if (!params.waitForResponse) return toolText(`Start request created for ${request.agentName}. Waiting for user approval.`, { request });
			const result = await waitForStartRequest(request, signal);
			return toolText(result, { requestId: request.id });
		},
	});

	pi.registerTool({
		name: "orchestrator_list_agent_statuses",
		label: "Orchestrator List Agent Statuses",
		description: "List status summaries for drafted and linked worker agents.",
		promptSnippet: "List current worker statuses",
		parameters: Type.Object({}),
		async execute() {
			const { context, agentStore, orchestratorStore } = await createStores();
			const drafts = await orchestratorStore.listDrafts(context.sessionId);
			const rows = drafts.map((draft) => {
				const job = draft.agentJobId ? agentStore.get(draft.agentJobId) : undefined;
				const pendingApprovals = job?.pendingApprovals.filter((approval) => approval.status === "pending").length ?? 0;
				return {
					name: job?.name ?? draft.name,
					order: draft.order,
					draftStatus: draft.status,
					agentStatus: job?.status ?? "not created",
					taskSummary: truncateText(job?.task ?? draft.task, 220),
					pendingApprovals,
					artifactCount: job?.artifacts.length ?? 0,
					lastActivity: job?.updatedAt ?? draft.updatedAt,
					hasFinalResponse: !!job?.finalResponse,
				};
			});
			const text = rows.length === 0 ? "No worker drafts yet." : rows.map((row) => `${row.order}. ${row.name} draft:${row.draftStatus} agent:${row.agentStatus} approvals:${row.pendingApprovals} artifacts:${row.artifactCount}`).join("\n");
			return toolText(text, { agents: rows });
		},
	});

	pi.registerTool({
		name: "orchestrator_get_agent_details",
		label: "Orchestrator Get Agent Details",
		description: "Get details for a specific worker, optionally waiting until it finishes.",
		promptSnippet: "Inspect a worker agent status and result",
		parameters: Type.Object({
			name: Type.String({ description: "Worker name." }),
			waitForResponse: Type.Optional(Type.Boolean({ description: "Whether to wait through running/waiting/blocked until terminal status." })),
		}),
		async execute(_toolCallId, params, signal) {
			if (params.waitForResponse) return toolText(await waitForAgentDetails(params.name, signal));
			const { context, agentStore, orchestratorStore } = await createStores();
			const safeName = sanitizeAgentName(params.name);
			const drafts = await orchestratorStore.listDrafts(context.sessionId);
			const draft = drafts.find((item) => sanitizeAgentName(item.name) === safeName);
			const job = draft?.agentJobId ? agentStore.get(draft.agentJobId) : agentStore.list().find((item) => sanitizeAgentName(item.name) === safeName);
			return toolText(formatAgentDetails(draft, job), { draft, jobId: job?.id });
		},
	});

	pi.registerTool({
		name: "orchestrator_suggest_artifact_edit",
		label: "Orchestrator Suggest Artifact Edit",
		description: "Create a review-only replacement suggestion attached to a worker artifact. It does not edit the artifact or project; the user may accept it from ARTIFACTS mode.",
		promptSnippet: "Suggest a replacement for a worker artifact without mutating it",
		promptGuidelines: [
			"Use orchestrator_get_agent_details first and copy an artifact path from 'Artifact paths for suggestions/review'.",
			"For proposal artifacts, artifactPath may be either the displayed .agents/... proposal path or the original project-relative path shown as '(original: ...)'.",
			"Provide the full replacement content for the target artifact, not a patch fragment.",
			"Never assume the suggestion has been applied until the user accepts it from ARTIFACTS mode.",
		],
		parameters: Type.Object({
			agentName: Type.String({ description: "Worker agent name." }),
			artifactPath: Type.String({ description: "Target artifact path. Prefer copying the .agents/... path from orchestrator_get_agent_details. For proposals, the original project-relative path is also accepted." }),
			content: Type.String({ description: "Full replacement content for the artifact if accepted by the user." }),
			summary: Type.Optional(Type.String({ description: "Short summary shown under the artifact." })),
		}),
		async execute(_toolCallId, params) {
			const { context, agentStore, orchestratorStore } = await createStores();
			const safeName = sanitizeAgentName(params.agentName);
			const job = agentStore.list().find((item) => item.name === safeName || sanitizeAgentName(item.name) === safeName);
			if (!job) throw new Error(`Unknown worker agent: ${params.agentName}`);
			const artifacts = await discoverArtifacts(job);
			agentStore.setArtifacts(job.id, artifacts);
			const refreshedJob = agentStore.get(job.id) ?? { ...job, artifacts };
			const session = orchestratorStore.get(context.sessionId);
			const suggestion = await createArtifactSuggestion(refreshedJob, {
				artifactPath: params.artifactPath,
				content: params.content,
				summary: params.summary,
				orchestratorSessionId: context.sessionId,
				orchestratorTitle: session?.orchestratorTitle ?? session?.title,
			});
			const artifactsWithSuggestion = await discoverArtifacts(refreshedJob);
			agentStore.setArtifacts(job.id, artifactsWithSuggestion);
			await agentStore.persistAll();
			await orchestratorStore.appendTranscript(context.sessionId, { kind: "tool", title: "Artifact suggestion created", toolName: "orchestrator_suggest_artifact_edit", message: `${job.name}: ${suggestion.artifactPath}`, output: params.summary });
			return toolText(`Created suggestion for ${suggestion.artifactPath}. The artifact and main project were not modified.`, { suggestion });
		},
	});

	pi.registerTool({
		name: "orchestrator_create_note",
		label: "Orchestrator Create Note",
		description: "Create or replace a named note inside the orchestrator session notes directory.",
		promptSnippet: "Create an orchestrator session note",
		parameters: Type.Object({ name: Type.String(), content: Type.String() }),
		async execute(_toolCallId, params) {
			const { context } = await createStores();
			const note = resolveNotePath(path.join(context.root, "sessions", context.sessionId), params.name);
			await withFileMutationQueue(note.absolutePath, async () => {
				await fs.mkdir(note.root, { recursive: true });
				await fs.writeFile(note.absolutePath, params.content, "utf8");
			});
			return toolText(`Created note ${note.fileName}.`, { note: note.fileName });
		},
	});

	pi.registerTool({
		name: "orchestrator_view_notes",
		label: "Orchestrator View Notes",
		description: "List notes or read a specific orchestrator session note.",
		promptSnippet: "List or read orchestrator notes",
		parameters: Type.Object({ note: Type.Optional(Type.String()) }),
		async execute(_toolCallId, params) {
			const { context } = await createStores();
			const notesRoot = path.join(context.root, "sessions", context.sessionId, "notes");
			if (!params.note?.trim()) {
				let entries: any[] = [];
				try { entries = await fs.readdir(notesRoot, { withFileTypes: true }); } catch {}
				const notes = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
					const stat = await fs.stat(path.join(notesRoot, entry.name));
					return `${entry.name} (${stat.size} bytes)`;
				}));
				return toolText(notes.length ? notes.join("\n") : "No notes found.", { count: notes.length });
			}
			const note = resolveNotePath(path.join(context.root, "sessions", context.sessionId), params.note);
			const content = await fs.readFile(note.absolutePath, "utf8");
			return toolText(`Note: ${note.fileName}\n\n${truncateText(content)}`, { note: note.fileName });
		},
	});

	pi.registerTool({
		name: "orchestrator_edit_note",
		label: "Orchestrator Edit Note",
		description: "Edit an existing orchestrator note with exact text replacements.",
		promptSnippet: "Edit an orchestrator note",
		parameters: Type.Object({
			name: Type.String(),
			edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
		}),
		async execute(_toolCallId, params) {
			const { context } = await createStores();
			const note = resolveNotePath(path.join(context.root, "sessions", context.sessionId), params.name);
			let content = await fs.readFile(note.absolutePath, "utf8");
			for (const edit of params.edits) {
				const count = content.split(edit.oldText).length - 1;
				if (count !== 1) throw new Error(`Expected exactly one occurrence of oldText in ${note.fileName}, found ${count}.`);
				content = content.replace(edit.oldText, edit.newText);
			}
			await withFileMutationQueue(note.absolutePath, async () => fs.writeFile(note.absolutePath, content, "utf8"));
			return toolText(`Edited note ${note.fileName}.`, { note: note.fileName, edits: params.edits.length });
		},
	});
}
