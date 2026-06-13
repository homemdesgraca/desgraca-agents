import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component } from "@earendil-works/pi-tui";
import type { AgentJob } from "../agents/agent-job.ts";
import { clampLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export class DeleteAgentDialog implements Component {
	constructor(
		private readonly job: AgentJob,
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
		const safeWidth = Math.max(46, width);
		const lines = [
			renderTopBorder(safeWidth, " Delete agent job ", this.theme),
			renderBoxedLine(this.theme.fg("warning", `Delete ${this.job.name}?`), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("muted", "This removes the dashboard job and its workspace:"), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("text", this.job.writableRoot), safeWidth, this.theme),
			renderDivider(safeWidth, this.theme),
			renderBoxedLine(`${this.theme.fg("error", "Y/Enter delete")}  ${this.theme.fg("accent", "N/Esc cancel")}`, safeWidth, this.theme),
			renderBottomBorder(safeWidth, this.theme),
		];
		return lines.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {}
}
