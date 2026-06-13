import * as fs from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { getAgentProcessEnvContext } from "./src/agents/agent-env.ts";
import { AgentStore } from "./src/agents/agent-store.ts";
import { PiSubprocessAgentRunner } from "./src/agents/agent-runner.ts";
import { Dashboard } from "./src/dashboard/Dashboard.ts";
import { decideToolPolicy } from "./src/permissions/policies.ts";
import { checkAgentReadScope, checkAgentWriteScope } from "./src/permissions/scope-guard.ts";
import { createDefaultSettings, cycleToolPolicy, knownPolicyTools, setToolPolicy, type AgentExtensionSettings, type ToolPolicy } from "./src/settings/settings.ts";

const SETTINGS_ENTRY = "desgraca-agents-settings";

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

export default function desgracaAgentsExtension(pi: ExtensionAPI) {
	const store = new AgentStore();
	let settings: AgentExtensionSettings = createDefaultSettings();
	const runner = new PiSubprocessAgentRunner(store, () => settings);

	function persistSettings(): void {
		pi.appendEntry<AgentExtensionSettings>(SETTINGS_ENTRY, settings);
	}

	function restoreSettings(ctx: ExtensionContext): void {
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === SETTINGS_ENTRY && entry.data) {
				const saved = entry.data as Partial<AgentExtensionSettings>;
				const defaults = createDefaultSettings();
				settings = {
					...defaults,
					...saved,
					toolPolicies: { ...defaults.toolPolicies, ...(saved.toolPolicies ?? {}) },
					childRunnerTools: saved.childRunnerTools ?? defaults.childRunnerTools,
				};
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

			let dashboard: Dashboard | undefined;
			await ctx.ui.custom((_tui, _theme, _keybindings, done) => {
				dashboard = new Dashboard(
					store,
					runner,
					{
						close: () => done(undefined),
						notify: (message, level = "info") => ctx.ui.notify(message, level),
						createJob: async () => {
							const name = await ctx.ui.input("Agent job name", "module-x-worker");
							if (!name) return;
							const task = await ctx.ui.editor("Agent task", "Describe the narrow task this worker should perform.");
							if (!task) return;
							const job = store.create(ctx.cwd, name, task);
							await fs.mkdir(job.writableRoot, { recursive: true });
							store.appendLog(job.id, `Workspace ready: ${job.writableRoot}`);
						},
					},
					_tui,
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
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify(`Agent policies: ${tools.map((tool) => `${tool}=${settings.toolPolicies[tool]}`).join(", ")}`, "info");
				return;
			}

			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("desgraca-agents permission settings")), 1, 0));
				container.addChild(new Text(theme.fg("dim", "Toggle policies between allow, ask, and deny. Defaults ask for bash/write/edit."), 1, 0));
				const items: SettingItem[] = tools.map((tool) => ({
					id: tool,
					label: tool,
					currentValue: settings.toolPolicies[tool],
					values: ["allow", "ask", "deny"],
				}));
				const list = new SettingsList(
					items,
					Math.min(items.length + 2, 14),
					getSettingsListTheme(),
					(id, newValue) => {
						settings = setToolPolicy(settings, id, newValue as ToolPolicy);
						persistSettings();
						ctx.ui.notify(`${id} policy is now ${newValue}`, "info");
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
