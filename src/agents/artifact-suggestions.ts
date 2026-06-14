import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { AgentArtifactSuggestion, AgentJob } from "./agent-job.ts";
import { isPathInside } from "../permissions/scope-guard.ts";

const SUGGESTIONS_DIR = "artifact-suggestions";
const SUGGESTIONS_FILE = "artifact-suggestions.json";

export interface CreateArtifactSuggestionInput {
	artifactPath: string;
	content: string;
	orchestratorSessionId: string;
	orchestratorTitle?: string;
	summary?: string;
}

function suggestionsMetadataPath(writableRoot: string): string {
	return path.join(writableRoot, SUGGESTIONS_FILE);
}

function suggestionFileName(artifactPath: string, id: string): string {
	const safeArtifact = artifactPath.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
	return `${safeArtifact}.${id}.suggestion`;
}

async function readMetadata(writableRoot: string): Promise<AgentArtifactSuggestion[]> {
	try {
		const raw = await fs.readFile(suggestionsMetadataPath(writableRoot), "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.id === "string" && typeof item?.artifactPath === "string") : [];
	} catch {
		return [];
	}
}

async function writeMetadata(writableRoot: string, suggestions: AgentArtifactSuggestion[]): Promise<void> {
	const filePath = suggestionsMetadataPath(writableRoot);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(suggestions, null, 2), "utf8");
}

export async function listArtifactSuggestions(writableRoot: string): Promise<AgentArtifactSuggestion[]> {
	const root = path.resolve(writableRoot);
	const metadata = await readMetadata(root);
	const existing: AgentArtifactSuggestion[] = [];
	for (const suggestion of metadata) {
		const absolutePath = path.resolve(suggestion.absolutePath);
		if (!isPathInside(root, absolutePath)) continue;
		try {
			const stat = await fs.stat(absolutePath);
			if (!stat.isFile()) continue;
			existing.push({ ...suggestion, absolutePath, sizeBytes: stat.size, updatedAt: stat.mtimeMs });
		} catch {}
	}
	return existing.sort((a, b) => a.artifactPath.localeCompare(b.artifactPath) || a.createdAt - b.createdAt);
}

function normalizeArtifactLookup(value: string): string {
	return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export async function createArtifactSuggestion(job: AgentJob, input: CreateArtifactSuggestionInput): Promise<AgentArtifactSuggestion> {
	const root = path.resolve(job.writableRoot);
	const lookup = normalizeArtifactLookup(input.artifactPath);
	const artifact = job.artifacts.find((item) => {
		const artifactPath = normalizeArtifactLookup(item.path);
		const relativeAbsolute = normalizeArtifactLookup(path.relative(job.readableRoot, item.absolutePath));
		const originalPath = item.originalPath ? normalizeArtifactLookup(item.originalPath) : undefined;
		return artifactPath === lookup || relativeAbsolute === lookup || originalPath === lookup;
	});
	const artifactPath = artifact?.path ?? input.artifactPath;
	if (!artifact && !artifactPath.startsWith(path.join(".agents", job.name))) throw new Error(`Unknown artifact for ${job.name}: ${input.artifactPath}. Use the artifact path shown by orchestrator_get_agent_details/ARTIFACTS, or a proposal's original path such as Misc/docker-stuff/media-stuff.yaml.`);
	const id = randomUUID();
	const relativePath = path.join(SUGGESTIONS_DIR, suggestionFileName(artifactPath, id));
	const absolutePath = path.resolve(root, relativePath);
	if (!isPathInside(root, absolutePath)) throw new Error("Suggestion path resolved outside the worker workspace.");
	const timestamp = Date.now();
	const suggestion: AgentArtifactSuggestion = {
		id,
		artifactPath,
		path: path.join(".agents", job.name, relativePath),
		absolutePath,
		sizeBytes: Buffer.byteLength(input.content, "utf8"),
		updatedAt: timestamp,
		createdAt: timestamp,
		orchestratorSessionId: input.orchestratorSessionId,
		orchestratorTitle: input.orchestratorTitle,
		summary: input.summary,
	};
	await withFileMutationQueue(absolutePath, async () => {
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, input.content, "utf8");
	});
	await withFileMutationQueue(suggestionsMetadataPath(root), async () => {
		const metadata = await readMetadata(root);
		await writeMetadata(root, [...metadata.filter((item) => item.id !== id), suggestion]);
	});
	return suggestion;
}

export async function applyArtifactSuggestion(job: AgentJob, suggestion: AgentArtifactSuggestion): Promise<string> {
	const root = path.resolve(job.writableRoot);
	const target = job.artifacts.find((artifact) => artifact.path === suggestion.artifactPath);
	if (!target) throw new Error(`Target artifact is no longer available: ${suggestion.artifactPath}`);
	const targetPath = path.resolve(target.absolutePath);
	const suggestionPath = path.resolve(suggestion.absolutePath);
	if (!isPathInside(root, targetPath) || !isPathInside(root, suggestionPath)) throw new Error("Refusing to apply suggestion outside the worker workspace.");
	const content = await fs.readFile(suggestionPath, "utf8");
	await withFileMutationQueue(targetPath, async () => fs.writeFile(targetPath, content, "utf8"));
	await withFileMutationQueue(suggestionsMetadataPath(root), async () => {
		const metadata = await readMetadata(root);
		await writeMetadata(root, metadata.filter((item) => item.id !== suggestion.id));
	});
	return `Applied orchestrator suggestion to ${target.path}. The main project was not modified.`;
}
