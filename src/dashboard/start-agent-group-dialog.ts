import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component } from "@earendil-works/pi-tui";
import { LARGE_AGENT_GROUP_WARNING_THRESHOLD, type GroupStartPlan } from "../agents/agent-groups.ts";
import { clampLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder, wrapPlainLine } from "./render.ts";

function shortSessionId(sessionId: string): string {
	return sessionId.length <= 12 ? sessionId : sessionId.slice(0, 12);
}

export class StartAgentGroupDialog implements Component {
	constructor(
		private readonly plan: GroupStartPlan,
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
		const safeWidth = Math.max(58, width);
		const group = this.plan.group;
		const runnable = this.plan.runnable;
		const skipped = this.plan.skipped;
		const lines = [
			renderTopBorder(safeWidth, " Start parallel agent group ", this.theme),
			renderBoxedLine(this.theme.fg("toolTitle", `Session ${shortSessionId(group.key.sessionId)} order ${group.key.order}`), safeWidth, this.theme),
			renderBoxedLine(this.theme.fg("muted", `Group members: ${group.jobs.length}. Runnable: ${runnable.length}. Skipped: ${skipped.length}.`), safeWidth, this.theme),
		];

		if (this.plan.largeWarning) {
			lines.push(renderBoxedLine(this.theme.fg("warning", `Large group warning: this will start up to ${runnable.length} of ${group.jobs.length} agents at once (threshold ${LARGE_AGENT_GROUP_WARNING_THRESHOLD}).`), safeWidth, this.theme));
		}

		lines.push(renderDivider(safeWidth, this.theme));
		lines.push(renderBoxedLine(this.theme.fg("success", "Runnable agents"), safeWidth, this.theme));
		if (runnable.length === 0) {
			lines.push(renderBoxedLine(this.theme.fg("warning", "No agents in this group are currently runnable."), safeWidth, this.theme));
		} else {
			for (const job of runnable) this.pushWrapped(lines, `- ${job.name} [${job.status}]`, safeWidth);
		}

		lines.push(renderDivider(safeWidth, this.theme));
		lines.push(renderBoxedLine(this.theme.fg(skipped.length > 0 ? "warning" : "muted", "Skipped agents"), safeWidth, this.theme));
		if (skipped.length === 0) {
			lines.push(renderBoxedLine(this.theme.fg("muted", "None."), safeWidth, this.theme));
		} else {
			for (const member of skipped) this.pushWrapped(lines, `- ${member.job.name}: ${member.reason ?? "not runnable"}`, safeWidth);
		}

		lines.push(renderDivider(safeWidth, this.theme));
		if (runnable.length === 0) {
			lines.push(renderBoxedLine(`${this.theme.fg("accent", "Enter/Y close")}  ${this.theme.fg("accent", "N/Esc cancel")}`, safeWidth, this.theme));
		} else {
			lines.push(renderBoxedLine(`${this.theme.fg("error", "Y/Enter start runnable")}  ${this.theme.fg("accent", "N/Esc cancel")}`, safeWidth, this.theme));
		}
		lines.push(renderBottomBorder(safeWidth, this.theme));
		return lines.map((line) => clampLine(line, safeWidth));
	}

	private pushWrapped(lines: string[], text: string, safeWidth: number): void {
		for (const line of wrapPlainLine(text, Math.max(10, safeWidth - 4))) {
			lines.push(renderBoxedLine(`  ${this.theme.fg("text", line)}`, safeWidth, this.theme));
		}
	}

	invalidate(): void {}
}
