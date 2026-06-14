import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component } from "@earendil-works/pi-tui";
import type { OrchestratorSession } from "../orchestrator/orchestrator-session.ts";
import { clampLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export class DeleteOrchestratorSessionDialog implements Component {
	constructor(
		private readonly session: OrchestratorSession,
		private readonly theme: Theme,
		private readonly done: (confirmed: boolean) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "enter") || data.toLowerCase() === "y") {
			this.done(true);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data.toLowerCase() === "n" || data.toLowerCase() === "q") {
			this.done(false);
		}
	}

	render(width: number): string[] {
		const safeWidth = Math.max(54, width);
		const lines = [
			renderTopBorder(safeWidth, " Delete orchestrator session ", this.theme),
			renderBoxedLine(this.theme.fg("warning", `Delete ${this.session.title}?`), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("muted", "This removes the orchestrator session files from disk."), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("muted", "Linked worker jobs are not deleted and remain visible in AGENTS mode."), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("text", `Session: ${this.session.id}`), safeWidth, this.theme),
			renderDivider(safeWidth, this.theme),
			renderBoxedLine(`${this.theme.fg("error", "Y/Enter delete")}  ${this.theme.fg("accent", "N/Esc cancel")}`, safeWidth, this.theme),
			renderBottomBorder(safeWidth, this.theme),
		];
		return lines.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {}
}
