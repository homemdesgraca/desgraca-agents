export type ToolPolicy = "allow" | "ask" | "deny";

export interface AgentExtensionSettings {
	toolPolicies: Record<string, ToolPolicy>;
	childRunnerTools: string[];
	taskWorkspaceDir: string;
}

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

export function createDefaultSettings(): AgentExtensionSettings {
	return {
		toolPolicies: { ...DEFAULT_TOOL_POLICIES },
		childRunnerTools: ["read", "grep", "find", "ls", "agent_write_proposal", "agent_edit_proposal", "agent_view_artifacts", "agent_create_note", "agent_edit_note", "agent_view_notes"],
		taskWorkspaceDir: ".agents",
	};
}

export function getToolPolicy(settings: AgentExtensionSettings, toolName: string): ToolPolicy {
	return settings.toolPolicies[toolName] ?? "ask";
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

export function cycleToolPolicy(policy: ToolPolicy): ToolPolicy {
	if (policy === "allow") return "ask";
	if (policy === "ask") return "deny";
	return "allow";
}

export function knownPolicyTools(settings: AgentExtensionSettings): string[] {
	return Object.keys(settings.toolPolicies).filter((tool) => tool !== "write" && tool !== "edit").sort((a, b) => a.localeCompare(b));
}
