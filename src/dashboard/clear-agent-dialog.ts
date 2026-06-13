import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component } from "@earendil-works/pi-tui";
import type { AgentJob } from "../agents/agent-job.ts";
import { clampLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export class ClearAgentDialog implements Component {
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
		const safeWidth = Math.max(50, width);
		const lines = [
			renderTopBorder(safeWidth, " Clear agent job ", this.theme),
			renderBoxedLine(this.theme.fg("warning", `Clear ${this.job.name}?`), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("muted", "This keeps the agent name, task, model, and workspace root."), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("muted", "It removes logs, tracking, approvals, final response, process state, and artifacts."), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("text", this.job.writableRoot), safeWidth, this.theme),
			renderDivider(safeWidth, this.theme),
			renderBoxedLine(`${this.theme.fg("error", "Y/Enter clear")}  ${this.theme.fg("accent", "N/Esc cancel")}`, safeWidth, this.theme),
			renderBottomBorder(safeWidth, this.theme),
		];
		return lines.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {}
}
