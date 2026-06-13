import type { AgentJob } from "../agents/agent-job.ts";
import type { AgentExtensionSettings, ToolPolicy } from "../settings/settings.ts";
import { getToolPolicy } from "../settings/settings.ts";
import { getRiskWarnings } from "./risk-warnings.ts";

export type PolicyAction = "allow" | "ask" | "deny";

export interface ToolPolicyDecision {
	action: PolicyAction;
	agentId?: string;
	agentName?: string;
	toolName: string;
	inputSummary: string;
	reason: string;
	warnings: string[];
	policy: ToolPolicy;
}

export function summarizeToolInput(toolName: string, input: unknown): string {
	if (!input || typeof input !== "object") return String(input ?? "");
	const data = input as Record<string, unknown>;
	if (toolName === "bash") return String(data.command ?? "").slice(0, 180);
	if (toolName === "read" || toolName === "write" || toolName === "edit" || toolName === "ls") {
		return String(data.path ?? data.file_path ?? "").slice(0, 180);
	}
	if (toolName === "grep") return `${String(data.pattern ?? "")} in ${String(data.path ?? ".")}`.slice(0, 180);
	if (toolName === "find") return `${String(data.pattern ?? "*")} in ${String(data.path ?? ".")}`.slice(0, 180);
	try {
		return JSON.stringify(input).slice(0, 180);
	} catch {
		return "(unserializable input)";
	}
}

export function decideToolPolicy(
	settings: AgentExtensionSettings,
	toolName: string,
	input: unknown,
	agent?: Pick<AgentJob, "id" | "name">,
): ToolPolicyDecision {
	const policy = getToolPolicy(settings, toolName);
	const warnings = getRiskWarnings(toolName, input);
	const inputSummary = summarizeToolInput(toolName, input);
	const agentLabel = agent ? ` for agent ${agent.name}` : "";

	if (policy === "allow") {
		return {
			action: "allow",
			agentId: agent?.id,
			agentName: agent?.name,
			toolName,
			inputSummary,
			reason: `Policy allows ${toolName}${agentLabel}.`,
			warnings,
			policy,
		};
	}
	if (policy === "deny") {
		return {
			action: "deny",
			agentId: agent?.id,
			agentName: agent?.name,
			toolName,
			inputSummary,
			reason: `Policy denies ${toolName}${agentLabel}.`,
			warnings,
			policy,
		};
	}
	return {
		action: "ask",
		agentId: agent?.id,
		agentName: agent?.name,
		toolName,
		inputSummary,
		reason: `Policy requires approval for ${toolName}${agentLabel}.`,
		warnings,
		policy,
	};
}
