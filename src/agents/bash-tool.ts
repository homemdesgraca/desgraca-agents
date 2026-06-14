import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { decideToolPolicy } from "../permissions/policies.ts";
import { normalizeAgentExtensionSettings, createDefaultSettings } from "../settings/settings.ts";
import { AGENT_SETTINGS_ENV, getAgentProcessEnvContext } from "./agent-env.ts";
import type { AgentApproval } from "./agent-job.ts";
import { createId } from "./agent-job.ts";
import { readApprovalBridgeRecord, writeApprovalBridgeRecord } from "./approval-bridge.ts";

export const AGENT_BASH_TOOL_NAME = "agent_bash";

interface AgentBashParams {
	command: string;
	timeout?: number;
}

interface CommandResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: string | null;
	timedOut: boolean;
}

function parseSettingsFromEnv() {
	const raw = process.env[AGENT_SETTINGS_ENV];
	if (!raw) return createDefaultSettings();
	try {
		return normalizeAgentExtensionSettings(JSON.parse(raw));
	} catch {
		return createDefaultSettings();
	}
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(new Error("Cancelled while waiting for approval."));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("Cancelled while waiting for approval."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function waitForDashboardApproval(writableRoot: string, approval: AgentApproval, signal?: AbortSignal): Promise<void> {
	await writeApprovalBridgeRecord(writableRoot, approval);
	const deadline = Date.now() + 30 * 60 * 1000;
	while (Date.now() < deadline) {
		const current = await readApprovalBridgeRecord(writableRoot, approval.id);
		if (current?.status === "approved") return;
		if (current?.status === "denied") throw new Error("Denied by user through desgraca-agents agent policy.");
		await delay(500, signal);
	}
	throw new Error("Timed out waiting for agent bash approval from the dashboard.");
}

function truncateOutput(text: string, limit = 48_000): string {
	if (Buffer.byteLength(text, "utf8") <= limit) return text;
	return `${text.slice(0, limit)}\n... truncated by agent_bash`;
}

function runCommand(command: string, cwd: string, timeoutSeconds: number | undefined, signal?: AbortSignal): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const child = spawn(command, {
			cwd,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const timeoutMs = Math.max(1, timeoutSeconds ?? 120) * 1000;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => {
				if (!child.killed) child.kill("SIGKILL");
			}, 3000).unref?.();
		}, timeoutMs);
		const onAbort = () => {
			child.kill("SIGTERM");
			reject(new Error("Command cancelled."));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (data) => {
			stdout = truncateOutput(stdout + data.toString());
		});
		child.stderr.on("data", (data) => {
			stderr = truncateOutput(stderr + data.toString());
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		child.on("close", (exitCode, closeSignal) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ stdout, stderr, exitCode, signal: closeSignal, timedOut });
		});
	});
}

export function registerAgentBashTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: AGENT_BASH_TOOL_NAME,
		label: "Agent Bash",
		description: "Run a shell command from an isolated worker using the worker bash policy without exposing ordinary bash.",
		promptSnippet: "Run a shell command through the agent-scoped bash policy",
		promptGuidelines: [
			"Use agent_bash when an isolated worker needs to run a shell command such as tests, searches, or build commands.",
			"agent_bash follows the worker bash policy from /agent-settings; ask mode waits for dashboard approval before running.",
		],
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run from the main project root." }),
			timeout: Type.Optional(Type.Number({ description: "Optional timeout in seconds. Defaults to 120 seconds." })),
		}),
		async execute(_toolCallId, params: AgentBashParams, signal, _onUpdate, ctx) {
			const agent = getAgentProcessEnvContext();
			if (!agent?.writableRoot) throw new Error("agent_bash is only available inside a marked desgraca-agents worker process.");
			const command = params.command.trim();
			if (!command) throw new Error("agent_bash requires a non-empty command.");

			const settings = parseSettingsFromEnv();
			const decision = decideToolPolicy(settings, "bash", { command, timeout: params.timeout }, { id: agent.id, name: agent.name });
			if (decision.action === "deny") throw new Error(decision.reason);
			if (decision.action === "ask") {
				await waitForDashboardApproval(agent.writableRoot, {
					id: createId(),
					agentId: agent.id,
					agentName: agent.name,
					toolName: "bash",
					inputSummary: decision.inputSummary,
					warnings: decision.warnings,
					reason: decision.reason,
					status: "pending",
					createdAt: Date.now(),
				}, signal);
			}

			const result = await runCommand(command, ctx.cwd, params.timeout, signal);
			const parts = [
				`Command: ${command}`,
				`Exit: ${result.exitCode ?? result.signal ?? "unknown"}${result.timedOut ? " (timed out)" : ""}`,
			];
			if (result.stdout.trim()) parts.push(`STDOUT:\n${result.stdout.trimEnd()}`);
			if (result.stderr.trim()) parts.push(`STDERR:\n${result.stderr.trimEnd()}`);
			return {
				content: [{ type: "text" as const, text: parts.join("\n\n") }],
				details: result,
			};
		},
	});
}
