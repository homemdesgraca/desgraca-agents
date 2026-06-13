import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getAgentProcessEnvContext } from "./agent-env.ts";
import { checkAgentReadScope, isPathInside } from "../permissions/scope-guard.ts";

function normalizeOriginalPath(cwd: string, originalPath: string): { absoluteOriginal: string; relativeOriginal: string } {
	const readScope = checkAgentReadScope(cwd, originalPath);
	if (!readScope.ok) throw new Error(readScope.error ?? "Scope violation: proposal source is outside the project.");

	const agentsRoot = path.resolve(cwd, ".agents");
	if (isPathInside(agentsRoot, readScope.absolutePath)) {
		throw new Error(`Scope violation: proposal originalPath must target the main project, not ${agentsRoot}.`);
	}

	const relativeOriginal = path.relative(path.resolve(cwd), readScope.absolutePath);
	if (!relativeOriginal || relativeOriginal.startsWith("..") || path.isAbsolute(relativeOriginal)) {
		throw new Error(`Scope violation: proposal originalPath must be inside ${path.resolve(cwd)}.`);
	}

	return { absoluteOriginal: readScope.absolutePath, relativeOriginal };
}

function getProposalPath(writableRoot: string, relativeOriginal: string): string {
	return path.join(path.resolve(writableRoot), "proposals", relativeOriginal);
}

function countOccurrences(content: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let offset = 0;
	while (true) {
		const index = content.indexOf(needle, offset);
		if (index === -1) return count;
		count++;
		offset = index + needle.length;
	}
}

async function writeProposalFile(destination: string, content: string): Promise<void> {
	await withFileMutationQueue(destination, async () => {
		await fs.mkdir(path.dirname(destination), { recursive: true });
		await fs.writeFile(destination, content, "utf8");
	});
}

function truncateText(content: string, maxBytes = 48_000): string {
	if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
	return `${content.slice(0, maxBytes)}\n... truncated by agent_view_artifacts`;
}

function plainDiff(originalContent: string, proposalContent: string): string {
	const original = originalContent.split("\n");
	const proposal = proposalContent.split("\n");
	const rows = Math.max(original.length, proposal.length);
	const lines = ["--- original", "+++ proposal"];
	for (let index = 0; index < rows; index++) {
		const before = original[index];
		const after = proposal[index];
		if (before === after && before !== undefined) lines.push(`  ${before}`);
		else {
			if (before !== undefined) lines.push(`- ${before}`);
			if (after !== undefined) lines.push(`+ ${after}`);
		}
	}
	return truncateText(lines.join("\n"));
}

async function walkArtifactFiles(root: string): Promise<Array<{ relativePath: string; absolutePath: string; sizeBytes: number; originalPath?: string; kind: "artifact" | "proposal" }>> {
	const files: Array<{ relativePath: string; absolutePath: string; sizeBytes: number; originalPath?: string; kind: "artifact" | "proposal" }> = [];
	async function walk(current: string): Promise<void> {
		let entries: any[];
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
			const relativePath = path.relative(root, absolutePath);
			const isProposal = relativePath === "proposals" || relativePath.startsWith(`proposals${path.sep}`);
			files.push({
				relativePath,
				absolutePath,
				sizeBytes: stat.size,
				kind: isProposal ? "proposal" : "artifact",
				originalPath: isProposal ? path.relative("proposals", relativePath) : undefined,
			});
		}
	}
	await walk(root);
	return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function resolveArtifactPath(cwd: string, writableRoot: string, inputPath: string): Promise<{ relativePath: string; absolutePath: string; originalPath?: string; kind: "artifact" | "proposal" }> {
	const root = path.resolve(writableRoot);
	const stripped = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	const candidates = [
		path.isAbsolute(stripped) ? path.resolve(stripped) : path.resolve(root, stripped),
		path.resolve(root, "proposals", stripped),
		path.resolve(cwd, stripped),
	];
	for (const candidate of candidates) {
		if (!isPathInside(root, candidate)) continue;
		try {
			const stat = await fs.stat(candidate);
			if (!stat.isFile()) continue;
			const relativePath = path.relative(root, candidate);
			const isProposal = relativePath === "proposals" || relativePath.startsWith(`proposals${path.sep}`);
			return { relativePath, absolutePath: candidate, kind: isProposal ? "proposal" : "artifact", originalPath: isProposal ? path.relative("proposals", relativePath) : undefined };
		} catch {}
	}
	throw new Error(`Artifact not found in ${root}: ${inputPath}`);
}

export function registerAgentProposalTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "agent_write_proposal",
		label: "Agent Write Proposal",
		description: "Create an isolated full-file proposal for an original project path. Writes only under the current agent's .agents workspace.",
		promptSnippet: "Create an isolated full-file proposal under .agents/{AGENT_NAME}/proposals/{originalPath}",
		promptGuidelines: [
			"Use agent_write_proposal when an isolated worker needs to propose a complete file for an original project path without modifying the real project.",
			"agent_write_proposal requires originalPath and content; do not invent .agents destination paths because the tool computes them automatically.",
		],
		parameters: Type.Object({
			originalPath: Type.String({ description: "Original project-relative file path that this proposal corresponds to." }),
			content: Type.String({ description: "Full proposed file content to write into the isolated proposal workspace." }),
			description: Type.Optional(Type.String({ description: "Short reason or summary for this proposal." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agent = getAgentProcessEnvContext();
			if (!agent?.writableRoot) throw new Error("agent_write_proposal is only available inside a marked desgraca-agents worker process.");
			const { relativeOriginal } = normalizeOriginalPath(ctx.cwd, params.originalPath);
			const proposalPath = getProposalPath(agent.writableRoot, relativeOriginal);
			await writeProposalFile(proposalPath, params.content);
			return {
				content: [
					{
						type: "text" as const,
						text: `Wrote isolated proposal for ${relativeOriginal} to ${path.relative(ctx.cwd, proposalPath)}. The original project file was not modified.`,
					},
				],
				details: {
					originalPath: relativeOriginal,
					proposalPath,
					description: params.description,
				},
			};
		},
	});

	pi.registerTool({
		name: "agent_view_artifacts",
		label: "Agent View Artifacts",
		description: "List the current isolated artifacts for this worker, or inspect one artifact/proposal. With a path, proposal artifacts return a diff against the original project file when possible.",
		promptSnippet: "List or inspect artifacts in the current agent workspace, including proposal diffs",
		promptGuidelines: [
			"Use agent_view_artifacts when an isolated worker needs to see what artifacts or proposals it has already created.",
			"Use agent_view_artifacts with a path to inspect a specific artifact or proposal diff instead of reading the original project file and expecting it to contain proposed changes.",
		],
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Optional artifact path, workspace-relative path, .agents path, or original project path for a proposal." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agent = getAgentProcessEnvContext();
			if (!agent?.writableRoot) throw new Error("agent_view_artifacts is only available inside a marked desgraca-agents worker process.");
			const root = path.resolve(agent.writableRoot);
			if (!params.path?.trim()) {
				const files = await walkArtifactFiles(root);
				const text = files.length === 0
					? `No artifacts found under ${path.relative(ctx.cwd, root) || root}.`
					: files.map((file, index) => `${index + 1}. ${file.kind} ${path.relative(ctx.cwd, file.absolutePath)} (${file.sizeBytes} bytes)${file.originalPath ? ` original: ${file.originalPath}` : ""}`).join("\n");
				return { content: [{ type: "text" as const, text }], details: { count: files.length } };
			}

			const artifact = await resolveArtifactPath(ctx.cwd, root, params.path);
			const content = await fs.readFile(artifact.absolutePath, "utf8");
			let text = `Artifact: ${path.relative(ctx.cwd, artifact.absolutePath)}\nType: ${artifact.kind}`;
			if (artifact.originalPath) text += `\nOriginal: ${artifact.originalPath}`;
			if (artifact.kind === "proposal" && artifact.originalPath) {
				const originalPath = path.resolve(ctx.cwd, artifact.originalPath);
				if (isPathInside(ctx.cwd, originalPath)) {
					let originalContent = "";
					try {
						originalContent = await fs.readFile(originalPath, "utf8");
					} catch {}
					text += `\n\n${plainDiff(originalContent, content)}`;
				} else {
					text += `\n\n${truncateText(content)}`;
				}
			} else {
				text += `\n\n${truncateText(content)}`;
			}
			return { content: [{ type: "text" as const, text }], details: artifact };
		},
	});

	pi.registerTool({
		name: "agent_edit_proposal",
		label: "Agent Edit Proposal",
		description: "Create an isolated proposal by applying exact replacements to an original project file in memory. Writes only under the current agent's .agents workspace.",
		promptSnippet: "Apply exact replacements to an original file and write the result under .agents/{AGENT_NAME}/proposals/{originalPath}",
		promptGuidelines: [
			"Use agent_edit_proposal when an isolated worker needs to propose exact changes to an existing project file without editing the real project.",
			"agent_edit_proposal requires originalPath and exact oldText/newText edits; the tool computes the .agents proposal destination automatically.",
		],
		parameters: Type.Object({
			originalPath: Type.String({ description: "Original project-relative file path to read as the proposal source." }),
			edits: Type.Array(
				Type.Object({
					oldText: Type.String({ description: "Exact text to replace. Must match uniquely in the current proposal content." }),
					newText: Type.String({ description: "Replacement text." }),
				}),
				{ minItems: 1 },
			),
			description: Type.Optional(Type.String({ description: "Short reason or summary for this proposal." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const agent = getAgentProcessEnvContext();
			if (!agent?.writableRoot) throw new Error("agent_edit_proposal is only available inside a marked desgraca-agents worker process.");
			const { absoluteOriginal, relativeOriginal } = normalizeOriginalPath(ctx.cwd, params.originalPath);
			let content = await fs.readFile(absoluteOriginal, "utf8");
			for (const [index, edit] of params.edits.entries()) {
				const matches = countOccurrences(content, edit.oldText);
				if (matches !== 1) {
					throw new Error(`Edit ${index + 1} for ${relativeOriginal} expected exactly one match, found ${matches}. No proposal was written.`);
				}
				content = content.replace(edit.oldText, edit.newText);
			}
			const proposalPath = getProposalPath(agent.writableRoot, relativeOriginal);
			await writeProposalFile(proposalPath, content);
			return {
				content: [
					{
						type: "text" as const,
						text: `Wrote isolated edit proposal for ${relativeOriginal} to ${path.relative(ctx.cwd, proposalPath)}. The original project file was not modified.`,
					},
				],
				details: {
					originalPath: relativeOriginal,
					proposalPath,
					edits: params.edits.length,
					description: params.description,
				},
			};
		},
	});
}
