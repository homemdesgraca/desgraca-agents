import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { AGENT_JOB_ID_ENV, AGENT_NAME_ENV, AGENT_SETTINGS_ENV, AGENT_WRITABLE_ROOT_ENV } from "./agent-env.ts";
import type { AgentArtifact, AgentJob } from "./agent-job.ts";
import { createId } from "./agent-job.ts";
import type { AgentStore } from "./agent-store.ts";
import type { AgentExtensionSettings } from "../settings/settings.ts";
import { listArtifactSuggestions } from "./artifact-suggestions.ts";

export interface AgentRunner {
	start(jobId: string): Promise<void>;
	send(jobId: string, message: string): Promise<void>;
	abort(jobId: string): void;
	isRunning(jobId: string): boolean;
}

interface RunningProcess {
	process: ChildProcess;
	aborted: boolean;
	artifactTimer?: ReturnType<typeof setInterval>;
	artifactRefreshInFlight?: boolean;
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

export function getRunnableTools(job: AgentJob, settings: AgentExtensionSettings): string[] {
	const configured = new Set(job.allowedTools.length > 0 ? job.allowedTools : settings.childRunnerTools);
	if ((settings.toolPolicies.bash ?? "ask") !== "deny") configured.add("bash");
	return Array.from(configured).filter((tool) => tool !== "write" && tool !== "edit" && settings.toolPolicies[tool] !== "deny");
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
			if (entry.name === "agent-job.json" || entry.name === "artifact-suggestions.json" || (entry.name.startsWith("agent-job.json.") && entry.name.endsWith(".tmp"))) continue;
			const absolutePath = path.join(current, entry.name);
			const relativeToWorkspace = path.relative(root, absolutePath);
			if (relativeToWorkspace === "artifact-suggestions" || relativeToWorkspace.startsWith(`artifact-suggestions${path.sep}`)) continue;
			if (entry.isDirectory()) {
				await walk(absolutePath);
				continue;
			}
			if (!entry.isFile()) continue;
			let stat: fsSync.Stats;
			try {
				stat = await fs.stat(absolutePath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			const isProposal = relativeToWorkspace === "proposals" || relativeToWorkspace.startsWith(`proposals${path.sep}`);
			const isNote = relativeToWorkspace === "notes" || relativeToWorkspace.startsWith(`notes${path.sep}`);
			const originalPath = isProposal ? path.relative("proposals", relativeToWorkspace) : undefined;
			artifacts.push({
				id: createId(),
				agentId,
				path: path.relative(cwd, absolutePath),
				absolutePath,
				sizeBytes: stat.size,
				updatedAt: stat.mtimeMs,
				kind: isProposal ? "proposal" : isNote ? "note" : "artifact",
				originalPath,
			});
		}
	}
	await walk(root);
	return artifacts;
}

export async function discoverArtifacts(job: AgentJob): Promise<AgentArtifact[]> {
	await ensureDirectory(job.writableRoot);
	const [artifacts, suggestions] = await Promise.all([
		walkFiles(job.writableRoot, job.readableRoot, job.id),
		listArtifactSuggestions(job.writableRoot),
	]);
	return artifacts.map((artifact) => ({ ...artifact, suggestions: suggestions.filter((suggestion) => suggestion.artifactPath === artifact.path) }));
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
		const safeTools = getRunnableTools(job, settings).join(",");
		const prompt = this.buildPrompt(job, followUp);

		const modelArgs = job.model ? ["--model", `${job.model.provider}/${job.model.id}`] : [];
		const args = ["--mode", "json", "-p", "--no-session", ...modelArgs, "--tools", safeTools, prompt];
		const invocation = getPiInvocation(args);
		const loggedArgs = invocation.args.map((arg) => (arg === prompt ? "<task prompt>" : arg));
		this.store.setStatus(jobId, "running");
		this.store.appendLog(jobId, `Starting isolated subprocess: ${invocation.command} ${loggedArgs.join(" ")}`);
		this.store.appendTracking(jobId, { kind: "status", title: followUp ? "Sending message" : "Worker started", message: `Isolated worker process started. Use agent-specific tools for proposals, artifacts, and notes.\n${invocation.command} ${loggedArgs.join(" ")}` });
		this.store.update(jobId, {
			process: {
				command: invocation.command,
				args: invocation.args,
				startedAt: Date.now(),
				readOnly: false,
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
				[AGENT_SETTINGS_ENV]: JSON.stringify(settings),
			},
		});
		const runningState: RunningProcess = { process: child, aborted: false };
		runningState.artifactTimer = setInterval(() => void this.refreshArtifactsWhileRunning(jobId), 1500);
		runningState.artifactTimer.unref?.();
		this.running.set(jobId, runningState);
		void this.refreshArtifactsWhileRunning(jobId);
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
			if (running?.artifactTimer) clearInterval(running.artifactTimer);
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
		const handoffPath = path.join(job.writableRoot, "notes", "orchestrator-handoff.md");
		const hasOrchestratorHandoff = fsSync.existsSync(handoffPath);
		const base = [
			`You are an isolated task-scoped worker named ${job.name}.`,
			`Main project root: ${job.readableRoot}`,
			"You may read/search the main project, but you must not directly modify files in the main project tree.",
			"The generic write and edit tools are intentionally not available to worker agents. Do not try to use them.",
			"Use agent_write_proposal when you need to create a full-file proposal for an original project file. Provide only originalPath and content; the tool stores the proposal for user review.",
			"Use agent_edit_proposal when you need to derive a proposal from an existing project file with exact oldText/newText replacements. It reads the original, writes an isolated proposal, and never mutates the project file.",
			"Use agent_view_artifacts to list current isolated artifacts or inspect a specific artifact/proposal diff. If you want to check your generated changes, inspect artifacts with that tool instead of reading the original project file and expecting it to be changed.",
			"Use agent_create_note, agent_edit_note, and agent_view_notes when you need to record, revise, list, or read notes. The note tools manage note files for you.",
			"The bash tool is available only when the worker bash policy is allow or ask in /agent-settings; ask mode requires user approval before the command runs.",
			"The user will inspect proposals before applying anything to the real project.",
			"If you need to change project code, create a proposal with agent_write_proposal or agent_edit_proposal instead of editing the main project directly.",
			...(hasOrchestratorHandoff ? [
				"Important orchestrator handoff:",
				"Earlier workers in this orchestrator session produced a handoff note for you at notes/orchestrator-handoff.md.",
				"Read it with agent_view_notes before assuming project state. Prior worker proposals are NOT applied to the main project files, so do not search the main project expecting those proposed changes to exist.",
				"Treat referenced prior proposals and notes as review-only context unless the user has explicitly applied them.",
			] : []),
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

	private async refreshArtifactsWhileRunning(jobId: string): Promise<void> {
		const running = this.running.get(jobId);
		if (!running || running.artifactRefreshInFlight) return;
		const job = this.store.get(jobId);
		if (!job) {
			if (running.artifactTimer) clearInterval(running.artifactTimer);
			this.running.delete(jobId);
			return;
		}
		running.artifactRefreshInFlight = true;
		try {
			this.store.setArtifacts(jobId, await discoverArtifacts(job));
		} catch (error) {
			this.store.appendLog(jobId, `Artifact refresh failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		} finally {
			running.artifactRefreshInFlight = false;
		}
	}

	private recordToolEvent(jobId: string, event: Record<string, any>): void {
		void this.refreshArtifactsWhileRunning(jobId);
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
		void this.refreshArtifactsWhileRunning(jobId);
		this.store.setStatus(jobId, "aborted");
		this.store.appendLog(jobId, "Abort requested by user.", "warning");
		running.process.kill("SIGTERM");
		setTimeout(() => {
			if (!running.process.killed) running.process.kill("SIGKILL");
		}, 5000);
	}
}
