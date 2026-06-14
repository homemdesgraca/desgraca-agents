import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { AGENT_SETTINGS_ENV, getAgentProcessEnvContext } from "./src/agents/agent-env.ts";
import type { AgentArtifact, AgentJob, AgentModelSelection } from "./src/agents/agent-job.ts";
import { AgentStore } from "./src/agents/agent-store.ts";
import { PiSubprocessAgentRunner } from "./src/agents/agent-runner.ts";
import { registerAgentProposalTools } from "./src/agents/proposal-tools.ts";
import { getOrchestratorProcessEnvContext } from "./src/orchestrator/orchestrator-env.ts";
import { PiSubprocessOrchestratorRunner } from "./src/orchestrator/orchestrator-runner.ts";
import { OrchestratorStore } from "./src/orchestrator/orchestrator-store.ts";
import { registerOrchestratorTools } from "./src/orchestrator/orchestrator-tools.ts";
import { ArtifactViewer } from "./src/dashboard/artifact-viewer.ts";
import { ClearAgentDialog } from "./src/dashboard/clear-agent-dialog.ts";
import { ClearOrchestratorSessionDialog } from "./src/dashboard/clear-orchestrator-session-dialog.ts";
import { CreateJobDialog, type CreateJobDialogResult } from "./src/dashboard/create-job-dialog.ts";
import { CreateOrchestratorSessionDialog, type CreateOrchestratorSessionDialogResult } from "./src/dashboard/create-orchestrator-session-dialog.ts";
import { Dashboard } from "./src/dashboard/Dashboard.ts";
import { DeleteAgentDialog } from "./src/dashboard/delete-agent-dialog.ts";
import { DeleteOrchestratorSessionDialog } from "./src/dashboard/delete-orchestrator-session-dialog.ts";
import { EditOrchestratorSessionDialog, type EditOrchestratorSessionDialogResult } from "./src/dashboard/edit-orchestrator-session-dialog.ts";
import { TrackingMessageDialog } from "./src/dashboard/tracking-message-dialog.ts";
import { decideOrchestratorToolPolicy, decideToolPolicy } from "./src/permissions/policies.ts";
import { checkAgentReadScope, checkAgentWriteScope, isPathInside } from "./src/permissions/scope-guard.ts";
import { createDefaultSettings, cycleToolPolicy, knownOrchestratorPolicyTools, knownPolicyTools, normalizeAgentExtensionSettings, setDefaultAgentModel, setOrchestratorToolPolicy, setToolPolicy, type AgentExtensionSettings, type DefaultAgentModelSelection, type ToolPolicy } from "./src/settings/settings.ts";

const SETTINGS_ENTRY = "desgraca-agents-settings";

function normalizeSettings(saved: Partial<AgentExtensionSettings> = {}): AgentExtensionSettings {
	return normalizeAgentExtensionSettings(saved);
}

export async function acceptArtifactProposal(job: AgentJob, artifact: AgentArtifact): Promise<string> {
	if (artifact.kind !== "proposal" || !artifact.originalPath) {
		throw new Error("Only proposal artifacts with an original path can be accepted.");
	}
	const targetPath = path.resolve(job.readableRoot, artifact.originalPath);
	const projectRoot = path.resolve(job.readableRoot);
	const agentsRoot = path.resolve(projectRoot, ".agents");
	if (!isPathInside(projectRoot, targetPath) || isPathInside(agentsRoot, targetPath)) {
		throw new Error(`Refusing to accept proposal outside the main project tree: ${targetPath}`);
	}

	const proposalRoot = path.resolve(job.writableRoot, "proposals");
	const sourcePath = path.resolve(artifact.absolutePath);
	const expectedSourcePath = path.resolve(proposalRoot, artifact.originalPath);
	if (sourcePath !== expectedSourcePath) {
		throw new Error(`Refusing to accept proposal from unexpected source path: ${sourcePath}. Expected ${expectedSourcePath}.`);
	}
	let realProposalRoot: string;
	let realSourcePath: string;
	try {
		[realProposalRoot, realSourcePath] = await Promise.all([fs.realpath(proposalRoot), fs.realpath(sourcePath)]);
	} catch {
		throw new Error(`Refusing to accept proposal because its source is not readable under ${proposalRoot}.`);
	}
	if (!isPathInside(realProposalRoot, realSourcePath)) {
		throw new Error(`Refusing to accept proposal source outside ${proposalRoot}: ${sourcePath}`);
	}

	const content = await fs.readFile(sourcePath, "utf8");
	await withFileMutationQueue(targetPath, async () => {
		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.writeFile(targetPath, content, "utf8");
	});
	return `Accepted proposal into ${artifact.originalPath}.`;
}

function getCreatableAgentModels(ctx: ExtensionContext): AgentModelSelection[] {
	const models = ctx.modelRegistry.getAvailable().map((model) => ({ provider: model.provider, id: model.id, label: `${model.provider}/${model.id}` }));
	if (ctx.model && !models.some((model) => model.provider === ctx.model?.provider && model.id === ctx.model?.id)) {
		models.unshift({ provider: ctx.model.provider, id: ctx.model.id, label: `${ctx.model.provider}/${ctx.model.id}` });
	}
	const currentIndex = ctx.model ? models.findIndex((model) => model.provider === ctx.model?.provider && model.id === ctx.model?.id) : -1;
	if (currentIndex > 0) {
		const [current] = models.splice(currentIndex, 1);
		if (current) models.unshift(current);
	}
	return models;
}

function getToolPathInput(toolName: string, input: unknown): string | undefined {
	if (!input || typeof input !== "object") return toolName === "grep" || toolName === "find" ? "." : undefined;
	const data = input as Record<string, unknown>;
	const value = data.path ?? data.file_path;
	if (typeof value === "string" && value.trim()) return value;
	if (toolName === "grep" || toolName === "find") return ".";
	return undefined;
}

function setToolPathInput(input: unknown, absolutePath: string): void {
	if (!input || typeof input !== "object") return;
	const data = input as Record<string, unknown>;
	if ("path" in data || !("file_path" in data)) data.path = absolutePath;
	else data.file_path = absolutePath;
}

function enforceAgentToolScope(
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
	agent: { name: string; writableRoot?: string },
): { block: true; reason: string } | undefined {
	const pathInput = getToolPathInput(toolName, input);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		const result = checkAgentReadScope(ctx.cwd, pathInput ?? ".");
		if (!result.ok) return { block: true, reason: result.error ?? "Scope violation: agent read denied." };
		return undefined;
	}
	if (["write", "edit"].includes(toolName)) {
		if (!pathInput) return { block: true, reason: `Scope violation: ${toolName} requires a target path for agent ${agent.name}.` };
		if (!agent.writableRoot) return { block: true, reason: `Scope violation: missing writable root for agent ${agent.name}.` };
		const result = checkAgentWriteScope({ name: agent.name, writableRoot: agent.writableRoot }, pathInput);
		if (!result.ok) return { block: true, reason: result.error ?? "Scope violation: agent write denied." };
		setToolPathInput(input, result.absolutePath);
	}
	return undefined;
}

function enforceOrchestratorToolScope(
	ctx: ExtensionContext,
	toolName: string,
	input: unknown,
	orchestrator: { sessionId: string; cwd: string },
): { block: true; reason: string } | undefined {
	if (["write", "edit", "agent_write_proposal", "agent_edit_proposal"].includes(toolName)) {
		return { block: true, reason: `Scope violation: ${toolName} is not available to orchestrator sessions.` };
	}
	const pathInput = getToolPathInput(toolName, input);
	if (["read", "grep", "find", "ls"].includes(toolName)) {
		const result = checkAgentReadScope(orchestrator.cwd || ctx.cwd, pathInput ?? ".");
		if (!result.ok) return { block: true, reason: result.error ?? "Scope violation: orchestrator read denied." };
		const agentsRoot = path.resolve(orchestrator.cwd || ctx.cwd, ".agents");
		if (isPathInside(agentsRoot, result.absolutePath)) return { block: true, reason: "Scope violation: use orchestrator status/detail tools instead of reading .agents internals." };
		return undefined;
	}
	return undefined;
}

export default function desgracaAgentsExtension(pi: ExtensionAPI) {
	const store = new AgentStore();
	const orchestratorStore = new OrchestratorStore(store);
	let settings: AgentExtensionSettings = createDefaultSettings();
	const runner = new PiSubprocessAgentRunner(store, () => settings);
	const orchestratorRunner = new PiSubprocessOrchestratorRunner(orchestratorStore, () => settings);
	const agentProcessContext = getAgentProcessEnvContext();
	const orchestratorProcessContext = getOrchestratorProcessEnvContext();
	if (agentProcessContext) registerAgentProposalTools(pi);
	if (orchestratorProcessContext) registerOrchestratorTools(pi);

	function persistSettings(): void {
		pi.appendEntry<AgentExtensionSettings>(SETTINGS_ENTRY, settings);
	}

	function restoreSettings(ctx: ExtensionContext): void {
		const orchestratorEnvContext = getOrchestratorProcessEnvContext();
		if (orchestratorEnvContext?.settings) {
			settings = normalizeSettings(orchestratorEnvContext.settings);
			return;
		}
		const envSettings = process.env[AGENT_SETTINGS_ENV];
		if (envSettings) {
			try {
				settings = normalizeSettings(JSON.parse(envSettings) as Partial<AgentExtensionSettings>);
				return;
			} catch {
				settings = createDefaultSettings();
				return;
			}
		}
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === SETTINGS_ENTRY && entry.data) {
				settings = normalizeSettings(entry.data as Partial<AgentExtensionSettings>);
			}
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		restoreSettings(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		restoreSettings(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		const orchestratorContext = getOrchestratorProcessEnvContext();
		if (orchestratorContext) {
			const scopeViolation = enforceOrchestratorToolScope(ctx, event.toolName, event.input, orchestratorContext);
			if (scopeViolation) return scopeViolation;
			const decision = decideOrchestratorToolPolicy(settings, event.toolName, event.input, { id: orchestratorContext.sessionId, name: "orchestrator" });
			if (decision.action === "allow") return;
			if (decision.action === "deny") return { block: true, reason: decision.reason };
			if (!ctx.hasUI) return { block: true, reason: `${decision.reason} No UI is available for orchestrator-scoped approval.` };
			const warningText = decision.warnings.length > 0 ? `\n\n${decision.warnings.join("\n")}` : "";
			const ok = await ctx.ui.confirm(
				`Allow orchestrator ${decision.toolName}?`,
				`${decision.reason}\n\nSession: ${orchestratorContext.sessionId}\nInput: ${decision.inputSummary || "(empty)"}${warningText}`,
			);
			if (!ok) return { block: true, reason: "Denied by user through desgraca-agents orchestrator policy." };
			return;
		}

		const agentContext = getAgentProcessEnvContext();
		if (!agentContext) return;

		const selected = store.get(agentContext.id);
		const scopedAgent = {
			id: agentContext.id,
			name: agentContext.name,
			writableRoot: selected?.writableRoot ?? agentContext.writableRoot,
		};
		const scopeViolation = enforceAgentToolScope(ctx, event.toolName, event.input, scopedAgent);
		if (scopeViolation) {
			if (selected) {
				store.setStatus(selected.id, "blocked");
				store.appendLog(selected.id, scopeViolation.reason, "error");
			}
			return scopeViolation;
		}

		const decision = decideToolPolicy(settings, event.toolName, event.input, scopedAgent);
		if (decision.action === "allow") return;
		if (decision.action === "deny") return { block: true, reason: decision.reason };
		const approval = selected
			? store.appendApproval(selected.id, {
					agentId: selected.id,
					agentName: selected.name,
					toolName: decision.toolName,
					inputSummary: decision.inputSummary,
					warnings: decision.warnings,
					reason: decision.reason,
				})
			: undefined;
		if (selected) store.setStatus(selected.id, "blocked");

		if (!ctx.hasUI) {
			if (selected && approval) store.resolveApproval(selected.id, approval.id, "denied");
			return { block: true, reason: `${decision.reason} No UI is available for agent-scoped approval.` };
		}

		const warningText = decision.warnings.length > 0 ? `\n\n${decision.warnings.join("\n")}` : "";
		const ok = await ctx.ui.confirm(
			`Allow agent ${decision.toolName}?`,
			`${decision.reason}\n\nAgent: ${agentContext.name}\nInput: ${decision.inputSummary || "(empty)"}${warningText}`,
		);
		if (selected && approval) store.resolveApproval(selected.id, approval.id, ok ? "approved" : "denied");
		if (selected) store.setStatus(selected.id, ok ? "waiting" : "blocked");
		if (!ok) return { block: true, reason: "Denied by user through desgraca-agents agent policy." };
	});

	pi.registerCommand("agents", {
		description: "Open the isolated agent dashboard",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("/agents dashboard requires TUI mode.", "warning");
				return;
			}

			await store.loadFromDisk(ctx.cwd);
			await orchestratorStore.loadFromDisk(ctx.cwd);
			let dashboard: Dashboard | undefined;
			await ctx.ui.custom((_tui, theme, _keybindings, done) => {
				dashboard = new Dashboard(
					store,
					runner,
					{
						close: () => done(undefined),
						notify: (message, level = "info") => ctx.ui.notify(message, level),
						clearJob: async (job) => {
							const ok = await ctx.ui.custom<boolean>(
								(_dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new ClearAgentDialog(job, dialogTheme, dialogDone),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "85%",
										minWidth: 52,
										maxHeight: "60%",
										margin: 2,
									},
								},
							);
							if (!ok) {
								_tui.requestRender();
								return false;
							}
							await store.clear(job.id);
							_tui.requestRender();
							return true;
						},
						openArtifactViewer: async (job, artifact) => {
							await ctx.ui.custom<void>(
								(viewerTui, viewerTheme, _viewerKeybindings, viewerDone) => new ArtifactViewer({
									job,
									artifact,
									theme: viewerTheme,
									viewportRows: Math.floor((((viewerTui as unknown as { terminal?: { rows?: number } }).terminal?.rows ?? 50) * 0.95)),
									onClose: viewerDone,
									requestRender: () => viewerTui.requestRender(),
									onAccept: async (acceptedJob, acceptedArtifact) => {
										const message = await acceptArtifactProposal(acceptedJob, acceptedArtifact);
										store.appendLog(acceptedJob.id, `${message} Source artifact: ${acceptedArtifact.path}`);
										store.appendTracking(acceptedJob.id, { kind: "status", title: "Artifact accepted", message: `${message}\nSource artifact: ${acceptedArtifact.path}` });
										return message;
									},
								}),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "95%",
										minWidth: 70,
										maxHeight: "95%",
										margin: 1,
									},
								},
							);
							_tui.requestRender();
						},
						sendMessage: async (job) => {
							const message = await ctx.ui.custom<string | undefined>(
								(dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new TrackingMessageDialog(dialogTui, dialogTheme, dialogDone, job.name),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "90%",
										minWidth: 54,
										maxHeight: "80%",
										margin: 2,
									},
								},
							);
							if (!message) {
								_tui.requestRender();
								return;
							}
							await runner.send(job.id, message);
						},
						createOrchestratorSession: async () => {
							const modelOptions = getCreatableAgentModels(ctx);
							const result = await ctx.ui.custom<CreateOrchestratorSessionDialogResult | undefined>(
								(dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new CreateOrchestratorSessionDialog(dialogTui, dialogTheme, dialogDone, modelOptions),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "92%",
										minWidth: 58,
										maxHeight: "88%",
										margin: 2,
									},
								},
							);
							if (!result) {
								_tui.requestRender();
								return;
							}
							const session = await orchestratorStore.create(ctx.cwd, { title: result.title, model: result.model });
							if (result.initialPrompt) await orchestratorRunner.send(session.id, result.initialPrompt);
							_tui.requestRender();
						},
						sendOrchestratorMessage: async (sessionId) => {
							const session = orchestratorStore.get(sessionId);
							const message = await ctx.ui.custom<string | undefined>(
								(dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new TrackingMessageDialog(dialogTui, dialogTheme, dialogDone, session?.title ?? "orchestrator"),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "90%",
										minWidth: 54,
										maxHeight: "80%",
										margin: 2,
									},
								},
							);
							if (!message) {
								_tui.requestRender();
								return;
							}
							await orchestratorRunner.send(sessionId, message);
							_tui.requestRender();
						},
						approveOrchestratorStartRequest: async (sessionId, requestId) => {
							const requests = await orchestratorStore.listStartRequests(sessionId);
							const request = requests.find((item) => item.id === requestId);
							if (!request) {
								ctx.ui.notify("Start request no longer exists.", "warning");
								return;
							}
							const ok = await ctx.ui.confirm("Start orchestrator-requested agent?", `Agent: ${request.agentName}\nWait requested: ${request.waitForResponse ? "yes" : "no"}\n\n${request.message}`);
							if (!ok) return;
							await orchestratorStore.resolveStartRequest(sessionId, requestId, { status: "approved" });
							await orchestratorStore.syncAllDrafts(settings);
							const latestRequests = await orchestratorStore.listStartRequests(sessionId);
							const latest = latestRequests.find((item) => item.id === requestId) ?? request;
							const job = latest.agentJobId ? store.get(latest.agentJobId) : store.list().find((item) => item.name === request.agentName);
							if (!job) {
								ctx.ui.notify(`No linked agent found for ${request.agentName}.`, "error");
								return;
							}
							if (runner.isRunning(job.id) || job.startedAt || job.finalResponse || job.process || job.status !== "draft") {
								ctx.ui.notify(`Agent ${job.name} has already started.`, "warning");
								return;
							}
							await orchestratorStore.markStartRequestStarted(sessionId, requestId, job.id);
							await runner.start(job.id);
							_tui.requestRender();
						},
						refreshOrchestratorState: async () => {
							await orchestratorStore.refresh();
							await orchestratorStore.syncAllDrafts(settings);
						},
						denyOrchestratorStartRequest: async (sessionId, requestId) => {
							const requests = await orchestratorStore.listStartRequests(sessionId);
							const request = requests.find((item) => item.id === requestId);
							if (!request) {
								ctx.ui.notify("Start request no longer exists.", "warning");
								return;
							}
							const ok = await ctx.ui.confirm("Deny orchestrator start request?", `Agent: ${request.agentName}\n\n${request.message}`);
							if (!ok) return;
							await orchestratorStore.resolveStartRequest(sessionId, requestId, { status: "denied", denialReason: "Denied by user from ORCHESTRATOR mode." });
							_tui.requestRender();
						},
						editOrchestratorSession: async (sessionId) => {
							const session = orchestratorStore.get(sessionId);
							if (!session) {
								ctx.ui.notify("Orchestrator session no longer exists.", "warning");
								return;
							}
							const modelOptions = getCreatableAgentModels(ctx);
							const result = await ctx.ui.custom<EditOrchestratorSessionDialogResult | undefined>(
								(dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new EditOrchestratorSessionDialog(dialogTui, dialogTheme, dialogDone, session, modelOptions),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "86%",
										minWidth: 52,
										maxHeight: "65%",
										margin: 2,
									},
								},
							);
							if (!result) {
								_tui.requestRender();
								return;
							}
							await orchestratorStore.updateSession(sessionId, { title: result.title, model: result.model });
							_tui.requestRender();
						},
						clearOrchestratorSession: async (sessionId) => {
							const session = orchestratorStore.get(sessionId);
							if (!session) {
								ctx.ui.notify("Orchestrator session no longer exists.", "warning");
								return false;
							}
							const ok = await ctx.ui.custom<boolean>(
								(_dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new ClearOrchestratorSessionDialog(session, dialogTheme, dialogDone),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "85%",
										minWidth: 54,
										maxHeight: "60%",
										margin: 2,
									},
								},
							);
							if (!ok) {
								_tui.requestRender();
								return false;
							}
							if (orchestratorRunner.isRunning(sessionId)) orchestratorRunner.abort(sessionId);
							await orchestratorStore.clearSession(sessionId);
							_tui.requestRender();
							return true;
						},
						deleteOrchestratorSession: async (sessionId) => {
							const session = orchestratorStore.get(sessionId);
							if (!session) {
								ctx.ui.notify("Orchestrator session no longer exists.", "warning");
								return false;
							}
							const ok = await ctx.ui.custom<boolean>(
								(_dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new DeleteOrchestratorSessionDialog(session, dialogTheme, dialogDone),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "85%",
										minWidth: 54,
										maxHeight: "60%",
										margin: 2,
									},
								},
							);
							if (!ok) {
								_tui.requestRender();
								return false;
							}
							if (orchestratorRunner.isRunning(sessionId)) orchestratorRunner.abort(sessionId);
							await orchestratorStore.deleteSession(sessionId);
							_tui.requestRender();
							return true;
						},
						deleteJob: async (job) => {
							const ok = await ctx.ui.custom<boolean>(
								(_dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new DeleteAgentDialog(job, dialogTheme, dialogDone),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "85%",
										minWidth: 50,
										maxHeight: "60%",
										margin: 2,
									},
								},
							);
							if (!ok) {
								_tui.requestRender();
								return false;
							}
							const deleted = await store.delete(job.id);
							_tui.requestRender();
							return deleted;
						},
						createJob: async () => {
							const modelOptions = getCreatableAgentModels(ctx);
							const result = await ctx.ui.custom<CreateJobDialogResult | undefined>(
								(dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new CreateJobDialog(dialogTui, dialogTheme, dialogDone, modelOptions),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "90%",
										minWidth: 54,
										maxHeight: "85%",
										margin: 2,
									},
								},
							);
							if (!result) {
								_tui.requestRender();
								return;
							}
							const job = store.create(ctx.cwd, result.name, result.task, result.model);
							await fs.mkdir(job.writableRoot, { recursive: true });
							store.appendLog(job.id, `Workspace ready: ${job.writableRoot}`);
						},
						editJob: async (job) => {
							const modelOptions = getCreatableAgentModels(ctx);
							const result = await ctx.ui.custom<CreateJobDialogResult | undefined>(
								(dialogTui, dialogTheme, _dialogKeybindings, dialogDone) => new CreateJobDialog(dialogTui, dialogTheme, dialogDone, modelOptions, {
									name: job.name,
									task: job.task,
									model: job.model,
									title: " Edit draft agent ",
									description: "Edit this draft worker before it starts. Saving marks it as user-edited.",
								}),
								{
									overlay: true,
									overlayOptions: {
										anchor: "center",
										width: "90%",
										minWidth: 54,
										maxHeight: "85%",
										margin: 2,
									},
								},
							);
							if (!result) {
								_tui.requestRender();
								return;
							}
							const updated = store.updateUserEditable(job.id, result);
							if (updated) store.appendLog(updated.id, "Draft agent edited by user.");
							_tui.requestRender();
						},
					},
					_tui,
					theme,
					orchestratorStore,
					orchestratorRunner,
				);
				return dashboard;
			});
			dashboard?.dispose();
		},
	});

	pi.registerCommand("agent-settings", {
		description: "Configure desgraca-agents permission policies",
		handler: async (_args, ctx) => {
			const tools = knownPolicyTools(settings);
			const orchestratorTools = knownOrchestratorPolicyTools(settings);
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify(`Agent policies: ${tools.map((tool) => `${tool}=${settings.toolPolicies[tool]}`).join(", ")} | Orchestrator policies: ${orchestratorTools.map((tool) => `${tool}=${settings.orchestrator.toolPolicies[tool]}`).join(", ")}`, "info");
				return;
			}

			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("desgraca-agents settings")), 1, 0));
				container.addChild(new Text(theme.fg("dim", "Worker policies, orchestrator policies, and default model for orchestrator-created workers."), 1, 0));
				const modelOptions = getCreatableAgentModels(ctx);
				const modelValues = ["default", ...modelOptions.map((model) => `${model.provider}/${model.id}`)];
				const currentDefaultModel = settings.agents.defaultModel === "default" ? "default" : `${settings.agents.defaultModel.provider}/${settings.agents.defaultModel.id}`;
				const items: SettingItem[] = [
					{
						id: "agent-default-model",
						label: "agents.defaultModel",
						currentValue: currentDefaultModel,
						values: modelValues,
					},
					...tools.map((tool) => ({
						id: `worker:${tool}`,
						label: `worker ${tool}`,
						currentValue: settings.toolPolicies[tool],
						values: ["allow", "ask", "deny"],
					})),
					...orchestratorTools.map((tool) => ({
						id: `orchestrator:${tool}`,
						label: `orchestrator ${tool}`,
						currentValue: settings.orchestrator.toolPolicies[tool],
						values: ["allow", "ask", "deny"],
					})),
				];
				const list = new SettingsList(
					items,
					Math.min(items.length + 2, 18),
					getSettingsListTheme(),
					(id, newValue) => {
						if (id === "agent-default-model") {
							let next: DefaultAgentModelSelection = "default";
							if (newValue !== "default") {
								const [provider, ...rest] = String(newValue).split("/");
								next = { provider: provider ?? "", id: rest.join("/"), label: String(newValue) };
							}
							settings = setDefaultAgentModel(settings, next);
						} else if (id.startsWith("worker:")) {
							settings = setToolPolicy(settings, id.slice("worker:".length), newValue as ToolPolicy);
						} else if (id.startsWith("orchestrator:")) {
							settings = setOrchestratorToolPolicy(settings, id.slice("orchestrator:".length), newValue as ToolPolicy);
						}
						persistSettings();
						ctx.ui.notify(`${id} is now ${newValue}`, "info");
					},
					() => done(undefined),
				);
				container.addChild(list);
				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						list.handleInput?.(data);
						_tui.requestRender();
					},
				};
			});
		},
	});

	pi.registerCommand("agent-policy-cycle", {
		description: "Cycle one agent tool policy: /agent-policy-cycle <tool>",
		handler: async (args, ctx) => {
			const tool = args.trim();
			if (!tool) {
				ctx.ui.notify("Usage: /agent-policy-cycle <tool>", "warning");
				return;
			}
			const next = cycleToolPolicy(settings.toolPolicies[tool] ?? "ask");
			settings = setToolPolicy(settings, tool, next);
			persistSettings();
			ctx.ui.notify(`${tool} policy is now ${next}`, "info");
		},
	});
}
