import * as fs from "node:fs";
import * as path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { AgentArtifact, AgentJob } from "../agents/agent-job.ts";
import { isPathInside } from "../permissions/scope-guard.ts";
import { clampLine, padLine, wrapPlainLine } from "./render.ts";

type ViewerMode = "diff" | "proposal" | "original";
type LineKind = "header" | "added" | "removed" | "context" | "raw" | "error" | "muted";

interface ViewerLine {
	kind: LineKind;
	text: string;
}

export interface ArtifactViewerOptions {
	job: AgentJob;
	artifact: AgentArtifact;
	theme?: Theme;
	viewportRows?: number;
	onClose(): void;
	onAccept?(job: AgentJob, artifact: AgentArtifact): Promise<string>;
	requestRender?(): void;
}

function fg(theme: Theme | undefined, color: Parameters<Theme["fg"]>[0], text: string): string {
	return theme ? theme.fg(color, text) : text;
}

function bold(theme: Theme | undefined, text: string): string {
	return theme ? theme.bold(text) : text;
}

function border(theme: Theme | undefined, text: string): string {
	return fg(theme, "borderAccent", text);
}

function splitFileLines(content: string): string[] {
	if (content.length === 0) return [""];
	return content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
}

function readTextFile(filePath: string): { ok: true; content: string } | { ok: false; error: string } {
	try {
		return { ok: true, content: fs.readFileSync(filePath, "utf8") };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function resolveOriginalPath(job: AgentJob, artifact: AgentArtifact): string | undefined {
	if (!artifact.originalPath) return undefined;
	const absolute = path.resolve(job.readableRoot, artifact.originalPath);
	if (!isPathInside(job.readableRoot, absolute)) return undefined;
	return absolute;
}

function simpleLineDiff(original: string[], proposal: string[]): ViewerLine[] {
	const output: ViewerLine[] = [];
	const rows = Math.max(original.length, proposal.length);
	for (let index = 0; index < rows; index++) {
		const before = original[index];
		const after = proposal[index];
		if (before === after && before !== undefined) output.push({ kind: "context", text: `  ${before}` });
		else {
			if (before !== undefined) output.push({ kind: "removed", text: `- ${before}` });
			if (after !== undefined) output.push({ kind: "added", text: `+ ${after}` });
		}
	}
	return output;
}

export function buildLineDiff(originalContent: string, proposalContent: string): ViewerLine[] {
	const original = splitFileLines(originalContent);
	const proposal = splitFileLines(proposalContent);
	const output: ViewerLine[] = [
		{ kind: "header", text: "--- original" },
		{ kind: "header", text: "+++ proposal" },
	];
	if (originalContent === proposalContent) return [...output, { kind: "muted", text: "No differences." }];
	if (original.length * proposal.length > 250_000) return [...output, ...simpleLineDiff(original, proposal)];

	const dp: number[][] = Array.from({ length: original.length + 1 }, () => Array(proposal.length + 1).fill(0));
	for (let i = original.length - 1; i >= 0; i--) {
		for (let j = proposal.length - 1; j >= 0; j--) {
			dp[i][j] = original[i] === proposal[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	let i = 0;
	let j = 0;
	while (i < original.length && j < proposal.length) {
		if (original[i] === proposal[j]) {
			output.push({ kind: "context", text: `  ${original[i]}` });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			output.push({ kind: "removed", text: `- ${original[i]}` });
			i++;
		} else {
			output.push({ kind: "added", text: `+ ${proposal[j]}` });
			j++;
		}
	}
	while (i < original.length) output.push({ kind: "removed", text: `- ${original[i++]}` });
	while (j < proposal.length) output.push({ kind: "added", text: `+ ${proposal[j++]}` });
	return output;
}

export class ArtifactViewer implements Component {
	private mode: ViewerMode;
	private scrollOffset = 0;
	private wrap = false;
	private notice: string | undefined;
	private awaitingAcceptConfirm = false;
	private accepting = false;
	private proposalRead: ReturnType<typeof readTextFile>;
	private originalRead: ReturnType<typeof readTextFile> | undefined;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(private readonly options: ArtifactViewerOptions) {
		this.mode = options.artifact.kind === "proposal" && options.artifact.originalPath ? "diff" : "proposal";
		this.proposalRead = readTextFile(options.artifact.absolutePath);
		this.refreshOriginalRead();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private rerender(): void {
		this.invalidate();
		this.options.requestRender?.();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q" || data === "Q") {
			this.options.onClose();
			return;
		}
		if (matchesKey(data, "up")) this.scrollBy(-1);
		else if (matchesKey(data, "down")) this.scrollBy(1);
		else if (matchesKey(data, "pageUp")) this.scrollBy(-this.bodyRows());
		else if (matchesKey(data, "pageDown")) this.scrollBy(this.bodyRows());
		else if (matchesKey(data, "home")) this.setScroll(0);
		else if (matchesKey(data, "end")) this.setScroll(Number.MAX_SAFE_INTEGER);
		else if (data === "d" || data === "D") this.setMode("diff");
		else if (data === "p" || data === "P") this.setMode("proposal");
		else if (data === "o" || data === "O") this.setMode("original");
		else if (data === "a" || data === "A") {
			void this.acceptArtifact();
		}
		else if (data === "w" || data === "W") {
			this.wrap = !this.wrap;
			this.scrollOffset = 0;
			this.awaitingAcceptConfirm = false;
			this.notice = this.wrap ? "Wrapping enabled." : "Wrapping disabled.";
			this.rerender();
		}
	}

	private setMode(mode: ViewerMode): void {
		if (mode === "diff" && !this.canShowProposalComparison()) {
			this.notice = "Diff view requires a readable proposal artifact with an original path.";
			this.rerender();
			return;
		}
		if (mode === "original" && !this.originalRead) {
			this.notice = "Original view requires a proposal artifact with an original path.";
			this.rerender();
			return;
		}
		this.mode = mode;
		this.notice = undefined;
		this.awaitingAcceptConfirm = false;
		this.scrollOffset = 0;
		this.rerender();
	}

	private canShowProposalComparison(): boolean {
		return this.proposalRead.ok && !!this.originalRead;
	}

	private canAccept(): boolean {
		return this.options.artifact.kind === "proposal" && !!this.options.artifact.originalPath && !!this.options.onAccept;
	}

	private refreshOriginalRead(): void {
		const originalPath = resolveOriginalPath(this.options.job, this.options.artifact);
		this.originalRead = originalPath ? readTextFile(originalPath) : undefined;
	}

	private async acceptArtifact(): Promise<void> {
		if (!this.canAccept()) {
			this.awaitingAcceptConfirm = false;
			this.notice = "Accept is available only for proposal artifacts with an original path.";
			this.rerender();
			return;
		}
		if (this.accepting) return;
		if (!this.awaitingAcceptConfirm) {
			this.awaitingAcceptConfirm = true;
			this.notice = `Press A again to accept this proposal into ${this.options.artifact.originalPath}.`;
			this.rerender();
			return;
		}
		this.accepting = true;
		this.notice = "Accepting proposal...";
		this.rerender();
		try {
			const message = await this.options.onAccept!(this.options.job, this.options.artifact);
			this.proposalRead = readTextFile(this.options.artifact.absolutePath);
			this.refreshOriginalRead();
			this.mode = this.options.artifact.kind === "proposal" && this.options.artifact.originalPath ? "diff" : this.mode;
			this.scrollOffset = 0;
			this.notice = message;
		} catch (error) {
			this.notice = `Accept failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			this.awaitingAcceptConfirm = false;
			this.accepting = false;
			this.rerender();
		}
	}

	private scrollBy(delta: number): void {
		this.setScroll(this.scrollOffset + delta);
	}

	private setScroll(offset: number): void {
		this.scrollOffset = Math.max(0, offset);
		this.rerender();
	}

	private bodyRows(): number {
		const viewport = this.options.viewportRows ?? 44;
		return Math.max(8, Math.min(60, Math.floor(viewport) - 8));
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const safeWidth = Math.max(30, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const bodyRows = this.bodyRows();
		const content = this.renderContent(innerWidth);
		const maxScroll = Math.max(0, content.length - bodyRows);
		this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
		const visible = content.slice(this.scrollOffset, this.scrollOffset + bodyRows);
		while (visible.length < bodyRows) visible.push("");
		const scrollInfo = content.length > bodyRows ? ` ${this.scrollOffset + 1}-${Math.min(content.length, this.scrollOffset + bodyRows)}/${content.length}` : ` ${content.length}/${content.length}`;
		const title = ` Artifact viewer ${scrollInfo} `;
		const lines = [
			this.topBorder(safeWidth, title),
			this.boxed(this.headerLine(innerWidth), safeWidth),
			this.boxed(this.artifactPathLine(innerWidth), safeWidth),
			this.boxed(this.finalPathLine(innerWidth), safeWidth),
			...(this.notice ? [this.boxed(fg(this.options.theme, "warning", this.notice), safeWidth)] : []),
			this.divider(safeWidth),
			...visible.map((line) => this.boxed(line, safeWidth)),
			this.divider(safeWidth),
			this.boxed(this.footer(innerWidth), safeWidth),
			this.bottomBorder(safeWidth),
		];
		this.cachedWidth = width;
		this.cachedLines = lines.map((line) => clampLine(line, safeWidth));
		return this.cachedLines;
	}

	private headerLine(width: number): string {
		const theme = this.options.theme;
		const mode = fg(theme, "accent", bold(theme, this.mode.toUpperCase()));
		return padLine(`${fg(theme, "dim", "agent:")} ${fg(theme, "text", this.options.job.name)}  ${fg(theme, "dim", "mode:")} ${mode}  ${fg(theme, "dim", "wrap:")} ${this.wrap ? "on" : "off"}`, width);
	}

	private artifactPathLine(width: number): string {
		const theme = this.options.theme;
		return padLine(`${fg(theme, "dim", "path:")} ${fg(theme, "text", this.options.artifact.path)}`, width);
	}

	private finalPathLine(width: number): string {
		const theme = this.options.theme;
		const finalPath = this.options.artifact.originalPath ?? "(review-only artifact; no accept target)";
		return padLine(`${fg(theme, "dim", "final path:")} ${fg(theme, this.options.artifact.originalPath ? "muted" : "warning", finalPath)}`, width);
	}

	private footer(width: number): string {
		const theme = this.options.theme;
		const key = (value: string) => fg(theme, "accent", bold(theme, value));
		const hints = this.options.artifact.kind === "proposal"
			? `${key("Up/Down")} scroll  ${key("PgUp/PgDn")} page  ${key("A")} accept  ${key("D")} diff  ${key("P")} proposal  ${key("O")} original  ${key("W")} wrap  ${key("Q/Esc")} close`
			: `${key("Up/Down")} scroll  ${key("PgUp/PgDn")} page  ${key("P")} raw  ${key("W")} wrap  ${key("Q/Esc")} close`;
		return padLine(hints, width);
	}

	private renderContent(width: number): string[] {
		const lines = this.contentLines();
		return lines.flatMap((line) => this.renderViewerLine(line, width));
	}

	private contentLines(): ViewerLine[] {
		if (this.mode === "original") {
			if (!this.originalRead) return [{ kind: "error", text: "Original file is not available for this artifact." }];
			if (!this.originalRead.ok) return [{ kind: "error", text: `Could not read original file: ${this.originalRead.error}` }];
			return this.rawLines(this.originalRead.content);
		}
		if (this.mode === "diff") {
			if (!this.proposalRead.ok || !this.originalRead) {
				return [{ kind: "error", text: "Diff view requires a readable proposal artifact and original path." }];
			}
			return buildLineDiff(this.originalRead.ok ? this.originalRead.content : "", this.proposalRead.content);
		}
		if (!this.proposalRead.ok) return [{ kind: "error", text: `Could not read artifact: ${this.proposalRead.error}` }];
		return this.rawLines(this.proposalRead.content);
	}

	private rawLines(content: string): ViewerLine[] {
		return splitFileLines(content).map((line, index) => ({ kind: "raw", text: `${String(index + 1).padStart(5, " ")} │ ${line}` }));
	}

	private renderViewerLine(line: ViewerLine, width: number): string[] {
		const theme = this.options.theme;
		const color = line.kind === "added" ? "success" : line.kind === "removed" ? "error" : line.kind === "header" ? "toolTitle" : line.kind === "error" ? "error" : line.kind === "muted" ? "muted" : "toolOutput";
		if (!this.wrap) return [clampLine(fg(theme, color, line.text), width)];
		return wrapPlainLine(line.text, width).map((part) => clampLine(fg(theme, color, part), width));
	}

	private topBorder(width: number, title: string): string {
		const innerWidth = Math.max(0, width - 2);
		const renderedTitle = ` ${fg(this.options.theme, "warning", bold(this.options.theme, title))} `;
		const fill = Math.max(0, innerWidth - visibleWidth(renderedTitle));
		return border(this.options.theme, "╭") + renderedTitle + border(this.options.theme, "─".repeat(fill) + "╮");
	}

	private bottomBorder(width: number): string {
		return border(this.options.theme, "╰" + "─".repeat(Math.max(0, width - 2)) + "╯");
	}

	private divider(width: number): string {
		return border(this.options.theme, "├" + "─".repeat(Math.max(0, width - 2)) + "┤");
	}

	private boxed(line: string, width: number): string {
		const innerWidth = Math.max(0, width - 2);
		return border(this.options.theme, "│") + padLine(line, innerWidth) + border(this.options.theme, "│");
	}
}
