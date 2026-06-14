import type { AgentJob } from "../agents/agent-job.ts";
import type { AgentExtensionSettings, ToolPolicy } from "../settings/settings.ts";
import { getOrchestratorToolPolicy, getToolPolicy } from "../settings/settings.ts";
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
	if (toolName === "agent_write_proposal" || toolName === "agent_edit_proposal") {
		return String(data.originalPath ?? "").slice(0, 180);
	}
	if (toolName === "orchestrator_create_agent_draft") {
		return `${String(data.name ?? "")} order ${String(data.order ?? "")}`.slice(0, 180);
	}
	if (toolName === "orchestrator_request_start_agent" || toolName === "orchestrator_get_agent_details") {
		return `${String(data.name ?? "")} wait=${String(data.waitForResponse ?? false)}`.slice(0, 180);
	}
	if (toolName === "orchestrator_suggest_artifact_edit") {
		return `${String(data.agentName ?? "")} ${String(data.artifactPath ?? "")}`.slice(0, 180);
	}
	if (toolName === "grep") return `${String(data.pattern ?? "")} in ${String(data.path ?? ".")}`.slice(0, 180);
	if (toolName === "find") return `${String(data.pattern ?? "*")} in ${String(data.path ?? ".")}`.slice(0, 180);
	try {
		return JSON.stringify(input).slice(0, 180);
	} catch {
		return "(unserializable input)";
	}
}

function buildDecision(
	policy: ToolPolicy,
	toolName: string,
	input: unknown,
	agent?: Pick<AgentJob, "id" | "name">,
): ToolPolicyDecision {
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

export function decideToolPolicy(
	settings: AgentExtensionSettings,
	toolName: string,
	input: unknown,
	agent?: Pick<AgentJob, "id" | "name">,
): ToolPolicyDecision {
	return buildDecision(getToolPolicy(settings, toolName), toolName, input, agent);
}

export function decideOrchestratorToolPolicy(
	settings: AgentExtensionSettings,
	toolName: string,
	input: unknown,
	session?: { id: string; name: string },
): ToolPolicyDecision {
	return buildDecision(getOrchestratorToolPolicy(settings, toolName), toolName, input, session ? { id: session.id, name: session.name } : undefined);
}
