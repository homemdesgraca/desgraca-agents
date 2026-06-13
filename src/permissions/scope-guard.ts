import * as path from "node:path";
import type { AgentJob } from "../agents/agent-job.ts";

export interface ScopeCheckResult {
	ok: boolean;
	absolutePath: string;
	error?: string;
}

function stripAtPrefix(inputPath: string): string {
	return inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
}

export function normalizeWithinCwd(cwd: string, inputPath: string): string {
	const cleanPath = stripAtPrefix(inputPath.trim());
	return path.resolve(cwd, cleanPath || ".");
}

export function isPathInside(parent: string, child: string): boolean {
	const relative = path.relative(path.resolve(parent), path.resolve(child));
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function checkAgentReadScope(cwd: string, inputPath: string): ScopeCheckResult {
	const absolutePath = normalizeWithinCwd(cwd, inputPath);
	const mainRoot = path.resolve(cwd);
	if (!isPathInside(mainRoot, absolutePath)) {
		return {
			ok: false,
			absolutePath,
			error: `Scope violation: agent reads are limited to ${mainRoot}. Requested ${absolutePath}.`,
		};
	}
	return { ok: true, absolutePath };
}

export function checkAgentWriteScope(job: Pick<AgentJob, "writableRoot" | "name">, inputPath: string): ScopeCheckResult {
	const absolutePath = path.isAbsolute(stripAtPrefix(inputPath))
		? path.resolve(stripAtPrefix(inputPath))
		: path.resolve(job.writableRoot, stripAtPrefix(inputPath));
	const writeRoot = path.resolve(job.writableRoot);
	if (!isPathInside(writeRoot, absolutePath)) {
		return {
			ok: false,
			absolutePath,
			error: `Scope violation: agent ${job.name} may only write under ${writeRoot}. Requested ${absolutePath}.`,
		};
	}
	return { ok: true, absolutePath };
}

export function assertAgentReadScope(cwd: string, inputPath: string): string {
	const result = checkAgentReadScope(cwd, inputPath);
	if (!result.ok) throw new Error(result.error);
	return result.absolutePath;
}

export function assertAgentWriteScope(job: Pick<AgentJob, "writableRoot" | "name">, inputPath: string): string {
	const result = checkAgentWriteScope(job, inputPath);
	if (!result.ok) throw new Error(result.error);
	return result.absolutePath;
}
