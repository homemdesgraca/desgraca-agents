import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { AGENT_JOB_ID_ENV, AGENT_NAME_ENV, AGENT_WRITABLE_ROOT_ENV } from "./agent-env.ts";
import type { AgentArtifact, AgentJob } from "./agent-job.ts";
import { createId } from "./agent-job.ts";
import type { AgentStore } from "./agent-store.ts";
import type { AgentExtensionSettings } from "../settings/settings.ts";

export interface AgentRunner {
	start(jobId: string): Promise<void>;
	send(jobId: string, message: string): Promise<void>;
	abort(jobId: string): void;
	isRunning(jobId: string): boolean;
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

async function ensureDirectory(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
}

async function walkFiles(root: string, cwd: string, agentId: string): Promise<AgentArtifact[]> {
	const artifacts: AgentArtifact[] = [];
	async function walk(current: string): Promise<void> {
		let entries: fsSync.Dirent[];
		try {
			entries = await fs.readdir(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "agent-job.json" || entry.name === "agent-job.json.tmp") continue;
			const absolutePath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(absolutePath);
				continue;
			}
			if (!entry.isFile()) continue;
			const stat = await fs.stat(absolutePath);
			artifacts.push({
				id: createId(),
				agentId,
				path: path.relative(cwd, absolutePath),
				absolutePath,
				sizeBytes: stat.size,
				updatedAt: stat.mtimeMs,
			});
		}
	}
	await walk(root);
	return artifacts;
}

export async function discoverArtifacts(job: AgentJob): Promise<AgentArtifact[]> {
	await ensureDirectory(job.writableRoot);
	return walkFiles(job.writableRoot, job.readableRoot, job.id);
}

export class PiSubprocessAgentRunner implements AgentRunner {
	private running = new Map<string, RunningProcess>();

	constructor(
		private readonly store: AgentStore,
		private readonly getSettings: () => AgentExtensionSettings,
	) {}

	isRunning(jobId: string): boolean {
		return this.running.has(jobId);
	}

	async start(jobId: string): Promise<void> {
		await this.run(jobId);
	}

	async send(jobId: string, message: string): Promise<void> {
		const trimmed = message.trim();
		if (!trimmed) return;
		this.store.appendTracking(jobId, { kind: "user", title: "User message", message: trimmed });
		this.store.appendLog(jobId, `User message:\n${trimmed}`);
		await this.run(jobId, trimmed);
	}

	private async run(jobId: string, followUp?: string): Promise<void> {
		const job = this.store.get(jobId);
		if (!job) return;
		if (this.running.has(jobId)) {
			this.store.appendLog(jobId, "Job is already running.", "warning");
			this.store.appendTracking(jobId, { kind: "status", title: "Already running", message: "Wait for the current worker turn to finish before sending another message." });
			return;
		}

		await ensureDirectory(job.writableRoot);
		const settings = this.getSettings();
		const safeTools = (job.allowedTools.length > 0 ? job.allowedTools : settings.childRunnerTools).join(",");
		const prompt = this.buildPrompt(job, followUp);

		const modelArgs = job.model ? ["--model", `${job.model.provider}/${job.model.id}`] : [];
		const args = ["--mode", "json", "-p", "--no-session", ...modelArgs, "--tools", safeTools, prompt];
		const invocation = getPiInvocation(args);
		const loggedArgs = invocation.args.map((arg) => (arg === prompt ? "<task prompt>" : arg));
		this.store.setStatus(jobId, "running");
		this.store.appendLog(jobId, `Starting read-only subprocess: ${invocation.command} ${loggedArgs.join(" ")}`);
		this.store.appendTracking(jobId, { kind: "status", title: followUp ? "Sending message" : "Worker started", message: `${invocation.command} ${loggedArgs.join(" ")}` });
		this.store.update(jobId, {
			process: {
				command: invocation.command,
				args: invocation.args,
				startedAt: Date.now(),
				readOnly: true,
			},
		});

		const child = spawn(invocation.command, invocation.args, {
			cwd: job.readableRoot,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				[AGENT_JOB_ID_ENV]: job.id,
				[AGENT_NAME_ENV]: job.name,
				[AGENT_WRITABLE_ROOT_ENV]: job.writableRoot,
			},
		});
		this.running.set(jobId, { process: child, aborted: false });
		this.store.update(jobId, (current) => ({ ...current, process: { ...current.process, pid: child.pid } }));

		let stdoutBuffer = "";
		const processJsonLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line) as Record<string, any>;
				if (event.type === "message_end" && event.message?.role === "assistant") {
					const text = event.message.content?.find?.((part: any) => part.type === "text")?.text;
					if (text) {
						this.store.update(jobId, { finalResponse: text });
						this.store.appendLog(jobId, `Final response:\n${text}`);
						this.store.appendTracking(jobId, { kind: "assistant", title: "Final response", message: text });
					}
				}
				if (typeof event.type === "string" && event.type.includes("tool")) {
					this.recordToolEvent(jobId, event);
				}
				if (event.error) {
					this.store.appendLog(jobId, String(event.error), "error");
					this.store.appendTracking(jobId, { kind: "error", title: "Worker error", message: String(event.error) });
				}
			} catch {
				this.store.appendLog(jobId, line.slice(0, 500), "debug");
			}
		};

		child.stdout.on("data", (data) => {
			stdoutBuffer += data.toString();
			const lines = stdoutBuffer.split("\n");
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) processJsonLine(line);
		});
		child.stderr.on("data", (data) => this.store.appendLog(jobId, data.toString().trim().slice(0, 1000), "warning"));
		child.on("error", (error) => {
			this.store.appendLog(jobId, `Subprocess error: ${error.message}`, "error");
		});
		child.on("close", async (code, signal) => {
			if (stdoutBuffer.trim()) processJsonLine(stdoutBuffer);
			const running = this.running.get(jobId);
			this.running.delete(jobId);
			const nextStatus = running?.aborted ? "aborted" : code === 0 ? "done" : "failed";
			this.store.update(jobId, (current) => ({
				...current,
				process: { ...current.process, exitedAt: Date.now(), exitCode: code, signal },
			}));
			this.store.setStatus(jobId, nextStatus);
			const title = nextStatus === "done" ? "FINISHED" : nextStatus.toUpperCase();
			this.store.appendLog(jobId, `Subprocess ${title} (exit ${code ?? "signal"}).`);
			this.store.appendTracking(jobId, { kind: nextStatus === "failed" ? "error" : "status", title, message: `Worker turn ended with ${code ?? signal ?? "unknown"}. You can send another message from TRACKING.` });
			const latest = this.store.get(jobId);
			if (latest) this.store.setArtifacts(jobId, await discoverArtifacts(latest));
		});
	}

	private buildPrompt(job: AgentJob, followUp?: string): string {
		const base = [
			`You are an isolated task-scoped worker named ${job.name}.`,
			`Main project root: ${job.readableRoot}`,
			`Writable artifact workspace: ${job.writableRoot}`,
			"For this MVP runner you are limited to safe read/search tools only. Do not attempt direct project mutations.",
			"Produce implementation notes, patch proposals, or artifact instructions in your final response.",
			"Task:",
			job.task,
		];
		if (!followUp) return base.join("\n");
		return [
			...base,
			"Previous final response:",
			job.finalResponse || "(none yet)",
			"User follow-up:",
			followUp,
		].join("\n");
	}

	private recordToolEvent(jobId: string, event: Record<string, any>): void {
		const toolName = String(event.toolName ?? event.name ?? event.tool?.name ?? "tool");
		const phase = String(event.type ?? "tool event").replace(/_/g, " ");
		const input = stringifyCompact(event.input ?? event.args ?? event.toolInput ?? event.params ?? event.tool?.input);
		const output = stringifyCompact(event.output ?? event.result ?? event.content ?? event.error);
		this.store.appendLog(jobId, `Tool ${phase}: ${toolName}${input ? `\nInput: ${input}` : ""}${output ? `\nOutput: ${output}` : ""}`, event.error ? "error" : "debug");
		this.store.appendTracking(jobId, {
			kind: "tool",
			title: `Tool: ${toolName}`,
			toolName,
			message: phase,
			input,
			output,
		});
	}

	abort(jobId: string): void {
		const running = this.running.get(jobId);
		if (!running) {
			this.store.appendLog(jobId, "No running process to abort.", "warning");
			return;
		}
		running.aborted = true;
		this.store.setStatus(jobId, "aborted");
		this.store.appendLog(jobId, "Abort requested by user.", "warning");
		running.process.kill("SIGTERM");
		setTimeout(() => {
			if (!running.process.killed) running.process.kill("SIGKILL");
		}, 5000);
	}
}
