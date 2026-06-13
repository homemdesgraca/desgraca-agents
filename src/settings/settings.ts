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
	write: "ask",
	edit: "ask",
};

export function createDefaultSettings(): AgentExtensionSettings {
	return {
		toolPolicies: { ...DEFAULT_TOOL_POLICIES },
		childRunnerTools: ["read", "grep", "find", "ls", "write"],
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
	return Object.keys(settings.toolPolicies).sort((a, b) => a.localeCompare(b));
}
