import type { AgentModelSelection } from "../agents/agent-job.ts";

export type ToolPolicy = "allow" | "ask" | "deny";

export type DefaultAgentModelSelection = "default" | AgentModelSelection;

export interface AgentExtensionSettings {
	toolPolicies: Record<string, ToolPolicy>;
	childRunnerTools: string[];
	taskWorkspaceDir: string;
	agents: {
		defaultModel: DefaultAgentModelSelection;
	};
	orchestrator: {
		toolPolicies: Record<string, ToolPolicy>;
		runnerTools: string[];
	};
}

export const AGENT_ONLY_TOOL_NAMES = ["agent_write_proposal", "agent_edit_proposal", "agent_view_artifacts", "agent_create_note", "agent_edit_note", "agent_view_notes"] as const;

export const ORCHESTRATOR_TOOL_NAMES = [
	"orchestrator_update_plan",
	"orchestrator_create_agent_draft",
	"orchestrator_request_start_agent",
	"orchestrator_list_agent_statuses",
	"orchestrator_get_agent_details",
	"orchestrator_suggest_artifact_edit",
	"orchestrator_create_note",
	"orchestrator_edit_note",
	"orchestrator_view_notes",
] as const;

export const FORBIDDEN_ORCHESTRATOR_TOOLS = ["write", "edit", "agent_write_proposal", "agent_edit_proposal", "agent_view_artifacts", "agent_create_note", "agent_edit_note", "agent_view_notes", "artifact_accept"] as const;

export const DEFAULT_TOOL_POLICIES: Record<string, ToolPolicy> = {
	read: "allow",
	grep: "allow",
	find: "allow",
	ls: "allow",
	bash: "ask",
	agent_write_proposal: "allow",
	agent_edit_proposal: "allow",
	agent_view_artifacts: "allow",
	agent_create_note: "allow",
	agent_edit_note: "allow",
	agent_view_notes: "allow",
};

export const DEFAULT_ORCHESTRATOR_TOOL_POLICIES: Record<string, ToolPolicy> = {
	read: "allow",
	grep: "allow",
	find: "allow",
	ls: "allow",
	bash: "deny",
	orchestrator_update_plan: "allow",
	orchestrator_create_agent_draft: "allow",
	orchestrator_request_start_agent: "allow",
	orchestrator_list_agent_statuses: "allow",
	orchestrator_get_agent_details: "allow",
	orchestrator_suggest_artifact_edit: "allow",
	orchestrator_create_note: "allow",
	orchestrator_edit_note: "allow",
	orchestrator_view_notes: "allow",
};

export const DEFAULT_CHILD_RUNNER_TOOLS = ["read", "grep", "find", "ls", "agent_bash", ...AGENT_ONLY_TOOL_NAMES];
export const DEFAULT_ORCHESTRATOR_RUNNER_TOOLS = ["read", "grep", "find", "ls", ...ORCHESTRATOR_TOOL_NAMES];

function sanitizeWorkerRunnerTools(tools: string[]): string[] {
	return Array.from(new Set(tools)).filter((tool) => tool !== "write" && tool !== "edit" && tool !== "bash");
}

export function sanitizeOrchestratorRunnerTools(tools: string[], policies: Record<string, ToolPolicy>): string[] {
	const forbidden = new Set<string>(FORBIDDEN_ORCHESTRATOR_TOOLS);
	return Array.from(new Set(tools))
		.filter((tool) => !forbidden.has(tool))
		.filter((tool) => tool !== "bash" || policies.bash !== "deny");
}

export function createDefaultSettings(): AgentExtensionSettings {
	return {
		toolPolicies: { ...DEFAULT_TOOL_POLICIES },
		childRunnerTools: [...DEFAULT_CHILD_RUNNER_TOOLS],
		taskWorkspaceDir: ".agents",
		agents: {
			defaultModel: "default",
		},
		orchestrator: {
			toolPolicies: { ...DEFAULT_ORCHESTRATOR_TOOL_POLICIES },
			runnerTools: [...DEFAULT_ORCHESTRATOR_RUNNER_TOOLS],
		},
	};
}

export function normalizeAgentExtensionSettings(saved: Partial<AgentExtensionSettings> = {}): AgentExtensionSettings {
	const defaults = createDefaultSettings();
	const workerPolicies = Object.fromEntries(Object.entries({ ...defaults.toolPolicies, ...(saved.toolPolicies ?? {}) }).filter(([tool]) => tool !== "write" && tool !== "edit"));
	const orchestratorPolicies = Object.fromEntries(Object.entries({ ...defaults.orchestrator.toolPolicies, ...(saved.orchestrator?.toolPolicies ?? {}) }).filter(([tool]) => !FORBIDDEN_ORCHESTRATOR_TOOLS.includes(tool as any)));
	return {
		...defaults,
		...saved,
		toolPolicies: workerPolicies,
		childRunnerTools: sanitizeWorkerRunnerTools([...(saved.childRunnerTools ?? defaults.childRunnerTools), "agent_bash", ...AGENT_ONLY_TOOL_NAMES]),
		agents: {
			...defaults.agents,
			...(saved.agents ?? {}),
			defaultModel: saved.agents?.defaultModel ?? defaults.agents.defaultModel,
		},
		orchestrator: {
			...defaults.orchestrator,
			...(saved.orchestrator ?? {}),
			toolPolicies: orchestratorPolicies,
			runnerTools: sanitizeOrchestratorRunnerTools([...(saved.orchestrator?.runnerTools ?? defaults.orchestrator.runnerTools), ...ORCHESTRATOR_TOOL_NAMES], orchestratorPolicies),
		},
	};
}

export function getToolPolicy(settings: AgentExtensionSettings, toolName: string): ToolPolicy {
	return settings.toolPolicies[toolName] ?? "ask";
}

export function getOrchestratorToolPolicy(settings: AgentExtensionSettings, toolName: string): ToolPolicy {
	return settings.orchestrator.toolPolicies[toolName] ?? "ask";
}

export function setToolPolicy(settings: AgentExtensionSettings, toolName: string, policy: ToolPolicy): AgentExtensionSettings {
	return {
		...settings,
		toolPolicies: {
			...settings.toolPolicies,
			[toolName]: policy,
		},
	};
}

export function setOrchestratorToolPolicy(settings: AgentExtensionSettings, toolName: string, policy: ToolPolicy): AgentExtensionSettings {
	const toolPolicies = {
		...settings.orchestrator.toolPolicies,
		[toolName]: policy,
	};
	return {
		...settings,
		orchestrator: {
			...settings.orchestrator,
			toolPolicies,
			runnerTools: sanitizeOrchestratorRunnerTools(settings.orchestrator.runnerTools, toolPolicies),
		},
	};
}

export function setDefaultAgentModel(settings: AgentExtensionSettings, defaultModel: DefaultAgentModelSelection): AgentExtensionSettings {
	return {
		...settings,
		agents: {
			...settings.agents,
			defaultModel,
		},
	};
}

export function cycleToolPolicy(policy: ToolPolicy): ToolPolicy {
	if (policy === "allow") return "ask";
	if (policy === "ask") return "deny";
	return "allow";
}

export function knownPolicyTools(settings: AgentExtensionSettings): string[] {
	return Object.keys(settings.toolPolicies).filter((tool) => tool !== "write" && tool !== "edit").sort((a, b) => a.localeCompare(b));
}

export function knownOrchestratorPolicyTools(settings: AgentExtensionSettings): string[] {
	const forbidden = new Set<string>(FORBIDDEN_ORCHESTRATOR_TOOLS);
	return Object.keys(settings.orchestrator.toolPolicies).filter((tool) => !forbidden.has(tool)).sort((a, b) => a.localeCompare(b));
}
