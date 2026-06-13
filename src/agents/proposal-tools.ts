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
