import { spawn, type ChildProcess } from "node:child_process";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { AgentExtensionSettings } from "../settings/settings.ts";
import { sanitizeOrchestratorRunnerTools } from "../settings/settings.ts";
import { ORCHESTRATOR_CWD_ENV, ORCHESTRATOR_MODEL_ENV, ORCHESTRATOR_ROOT_ENV, ORCHESTRATOR_SESSION_ID_ENV, ORCHESTRATOR_SETTINGS_ENV } from "./orchestrator-env.ts";
import type { OrchestratorSession } from "./orchestrator-session.ts";
import type { OrchestratorStore } from "./orchestrator-store.ts";

export interface OrchestratorRunner {
	start(sessionId: string, message?: string): Promise<void>;
	send(sessionId: string, message: string): Promise<void>;
	abort(sessionId: string): void;
	isRunning(sessionId: string): boolean;
}

interface RunningProcess {
	process: ChildProcess;
	aborted: boolean;
}

function stringifyCompact(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return text.length > 2000 ? `${text.slice(0, 2000)}\n... truncated` : text;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fsSync.existsSync(currentScript) && !currentScript.startsWith("/$bunfs/root/")) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
	return { command: "pi", args };
}

function getRunnableTools(settings: AgentExtensionSettings): string[] {
	return sanitizeOrchestratorRunnerTools(settings.orchestrator.runnerTools, settings.orchestrator.toolPolicies).filter((tool) => settings.orchestrator.toolPolicies[tool] !== "deny");
}

export class PiSubprocessOrchestratorRunner implements OrchestratorRunner {
	private running = new Map<string, RunningProcess>();

	constructor(
		private readonly store: OrchestratorStore,
		private readonly getSettings: () => AgentExtensionSettings,
	) {}

	isRunning(sessionId: string): boolean {
		return this.running.has(sessionId);
	}

	async start(sessionId: string, message?: string): Promise<void> {
		await this.run(sessionId, message);
	}

	async send(sessionId: string, message: string): Promise<void> {
		const trimmed = message.trim();
		if (!trimmed) return;
		await this.store.appendTranscript(sessionId, { kind: "user", title: "User message", message: trimmed });
		await this.run(sessionId, trimmed);
	}

	abort(sessionId: string): void {
		const running = this.running.get(sessionId);
		if (!running) return;
		running.aborted = true;
		void this.store.setStatus(sessionId, "aborted");
		void this.store.appendTranscript(sessionId, { kind: "status", title: "Abort requested", message: "The orchestrator subprocess was asked to stop." });
		running.process.kill("SIGTERM");
		setTimeout(() => {
			if (!running.process.killed) running.process.kill("SIGKILL");
		}, 5000);
	}

	private async run(sessionId: string, message?: string): Promise<void> {
		const session = this.store.get(sessionId);
		if (!session) return;
		if (this.running.has(sessionId)) {
			await this.store.appendTranscript(sessionId, { kind: "status", title: "Already running", message: "Wait for the current orchestrator turn to finish before sending another message." });
			return;
		}

		const settings = this.getSettings();
		const safeTools = getRunnableTools(settings).join(",");
		const prompt = this.buildPrompt(session, message);
		const modelArgs = session.model ? ["--model", `${session.model.provider}/${session.model.id}`] : [];
		const args = ["--mode", "json", "-p", "--no-session", ...modelArgs, "--tools", safeTools, prompt];
		const invocation = getPiInvocation(args);
		const loggedArgs = invocation.args.map((arg) => (arg === prompt ? "<orchestrator prompt>" : arg));
		const root = this.store.getOrchestratorRoot(session.cwd);
		await this.store.setStatus(sessionId, "running");
		await this.store.appendTranscript(sessionId, { kind: "status", title: message ? "Sending message" : "Orchestrator started", message: `${invocation.command} ${loggedArgs.join(" ")}` });
		await this.store.updateSession(sessionId, { process: { command: invocation.command, args: invocation.args, startedAt: Date.now() } });

		const child = spawn(invocation.command, invocation.args, {
			cwd: session.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				[ORCHESTRATOR_SESSION_ID_ENV]: session.id,
				[ORCHESTRATOR_ROOT_ENV]: root,
				[ORCHESTRATOR_CWD_ENV]: session.cwd,
				[ORCHESTRATOR_SETTINGS_ENV]: JSON.stringify(settings),
				...(session.model ? { [ORCHESTRATOR_MODEL_ENV]: JSON.stringify(session.model) } : {}),
			},
		});
		this.running.set(sessionId, { process: child, aborted: false });
		await this.store.updateSession(sessionId, { process: { command: invocation.command, args: invocation.args, startedAt: Date.now(), pid: child.pid } });

		let stdoutBuffer = "";
		const processJsonLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line) as Record<string, any>;
				if (event.type === "message_end" && event.message?.role === "assistant") {
					const text = event.message.content?.find?.((part: any) => part.type === "text")?.text;
					if (text) void this.store.appendTranscript(sessionId, { kind: "assistant", title: "Assistant response", message: text });
				}
				if (typeof event.type === "string" && event.type.includes("tool")) this.recordToolEvent(sessionId, event);
				if (event.error) void this.store.appendTranscript(sessionId, { kind: "error", title: "Orchestrator error", message: String(event.error) });
			} catch {
				void this.store.appendTranscript(sessionId, { kind: "status", title: "Raw output", message: line.slice(0, 500) });
			}
		};

		child.stdout.on("data", (data) => {
			stdoutBuffer += data.toString();
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) processJsonLine(line);
		});
		child.stderr.on("data", (data) => void this.store.appendTranscript(sessionId, { kind: "error", title: "stderr", message: data.toString().trim().slice(0, 1000) }));
		child.on("error", (error) => void this.store.appendTranscript(sessionId, { kind: "error", title: "Subprocess error", message: error.message }));
		child.on("close", (code, signal) => {
			void (async () => {
				if (stdoutBuffer.trim()) processJsonLine(stdoutBuffer);
				const running = this.running.get(sessionId);
				this.running.delete(sessionId);
				const nextStatus = running?.aborted ? "aborted" : code === 0 ? "done" : "failed";
				await this.store.updateSession(sessionId, { process: { ...(this.store.get(sessionId)?.process ?? {}), exitedAt: Date.now(), exitCode: code, signal } });
				await this.store.setStatus(sessionId, nextStatus);
				await this.store.refreshStartRequestsFromJobs();
				await this.store.appendTranscript(sessionId, { kind: nextStatus === "failed" ? "error" : "status", title: nextStatus.toUpperCase(), message: `Orchestrator turn ended with ${code ?? signal ?? "unknown"}.` });
			})();
		});
	}

	private buildPrompt(session: OrchestratorSession, message?: string): string {
		return [
			`You are the main orchestrator for the desgraca-agents dashboard session "${session.title}".`,
			`Main project root: ${session.cwd}`,
			"You plan and coordinate worker agents only. You are separate from the user's ordinary pi session and separate from worker agents.",
			"You must not directly edit project files, write project proposals, apply artifacts, or approve worker tool calls.",
			"When you need workers, use orchestrator_create_agent_draft with only name, task, and order.",
			"Do not set worker model, permissions, or advanced configuration. The user controls those in AGENTS mode and settings.",
			"To start a worker, use orchestrator_request_start_agent. This asks the user for approval and never starts a worker unconditionally.",
			"If waitForResponse is true, you will wait until the user denies the start or the worker reaches done, failed, or aborted. If the worker is blocked on approvals, keep waiting.",
			"Use orchestrator_list_agent_statuses and orchestrator_get_agent_details to inspect progress before deciding next steps.",
			"Use orchestrator_update_plan to keep a concise current plan for the user.",
			"User message:",
			message || "Begin or continue orchestrating this project based on the conversation and current session state.",
		].join("\n");
	}

	private recordToolEvent(sessionId: string, event: Record<string, any>): void {
		const toolName = String(event.toolName ?? event.name ?? event.tool?.name ?? "tool");
		const phase = String(event.type ?? "tool event").replace(/_/g, " ");
		const input = stringifyCompact(event.input ?? event.args ?? event.toolInput ?? event.params ?? event.tool?.input);
		const output = stringifyCompact(event.output ?? event.result ?? event.content ?? event.error);
		void this.store.appendTranscript(sessionId, { kind: event.error ? "error" : "tool", title: `Tool: ${toolName}`, toolName, message: phase, input, output });
	}
}
