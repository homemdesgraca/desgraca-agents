import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type Component } from "@earendil-works/pi-tui";
import type { GroupStartPlan } from "../agents/agent-groups.ts";
import type { AgentJob } from "../agents/agent-job.ts";
import type { OrchestratorStartRequest } from "../orchestrator/orchestrator-session.ts";
import { clampLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder, wrapPlainLine } from "./render.ts";

export type OrchestratorStartRequestDialogMode = "approve" | "deny";

export interface OrchestratorStartRequestDialogOptions {
	request: OrchestratorStartRequest;
	mode: OrchestratorStartRequestDialogMode;
	job?: AgentJob;
	plan?: GroupStartPlan;
	theme: Theme;
	done: (confirmed: boolean) => void;
}

function requestTitle(request: OrchestratorStartRequest): string {
	if ((request.kind ?? "agent") === "order") return `order ${request.order ?? "?"}`;
	return request.agentName;
}

export class OrchestratorStartRequestDialog implements Component {
	constructor(private readonly options: OrchestratorStartRequestDialogOptions) {}

	handleInput(data: string): void {
		if (matchesKey(data, "enter") || data.toLowerCase() === "y") {
			this.options.done(true);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data.toLowerCase() === "n" || data.toLowerCase() === "q") {
			this.options.done(false);
		}
	}

	render(width: number): string[] {
		const safeWidth = Math.max(62, width);
		const { request, mode, theme } = this.options;
		const approving = mode === "approve";
		const lines = [
			renderTopBorder(safeWidth, approving ? " Approve orchestrator start request " : " Deny orchestrator start request ", theme),
			renderBoxedLine(theme.fg(approving ? "warning" : "error", `Action required: ${approving ? "approve" : "deny"} start request for ${requestTitle(request)}.`), safeWidth, theme),
			renderBoxedLine(theme.fg("muted", `Kind: ${request.kind ?? "agent"}  Wait requested: ${request.waitForResponse ? "yes" : "no"}`), safeWidth, theme),
		];
		if (request.order !== undefined) lines.push(renderBoxedLine(theme.fg("muted", `Order: ${request.order}`), safeWidth, theme));
		this.pushWrapped(lines, `Message: ${request.message}`, safeWidth);

		if (this.options.plan) this.renderPlan(lines, safeWidth);
		else if (this.options.job) this.renderJob(lines, safeWidth);
		else if (request.agentNames?.length) {
			lines.push(renderDivider(safeWidth, theme));
			lines.push(renderBoxedLine(theme.fg("toolTitle", "Requested agents"), safeWidth, theme));
			for (const name of request.agentNames) this.pushWrapped(lines, `- ${name}`, safeWidth);
		}

		lines.push(renderDivider(safeWidth, theme));
		lines.push(renderBoxedLine(approving
			? `${theme.fg("error", "Y/Enter approve and start runnable")}  ${theme.fg("accent", "N/Esc cancel")}`
			: `${theme.fg("error", "Y/Enter deny request")}  ${theme.fg("accent", "N/Esc cancel")}`,
		safeWidth, theme));
		lines.push(renderBottomBorder(safeWidth, theme));
		return lines.map((line) => clampLine(line, safeWidth));
	}

	private renderJob(lines: string[], safeWidth: number): void {
		const { job, theme } = this.options;
		if (!job) return;
		lines.push(renderDivider(safeWidth, theme));
		lines.push(renderBoxedLine(theme.fg("toolTitle", "Target agent"), safeWidth, theme));
		this.pushWrapped(lines, `${job.name} [${job.status}]`, safeWidth);
		this.pushWrapped(lines, `Task: ${job.task}`, safeWidth);
	}

	private renderPlan(lines: string[], safeWidth: number): void {
		const { plan, theme } = this.options;
		if (!plan) return;
		lines.push(renderDivider(safeWidth, theme));
		lines.push(renderBoxedLine(theme.fg("toolTitle", `Runnable agents (${plan.runnable.length})`), safeWidth, theme));
		if (plan.runnable.length === 0) lines.push(renderBoxedLine(theme.fg("warning", "No agents are currently runnable."), safeWidth, theme));
		else for (const job of plan.runnable) this.pushWrapped(lines, `- ${job.name} [${job.status}]`, safeWidth);
		lines.push(renderBoxedLine(theme.fg(plan.skipped.length > 0 ? "warning" : "muted", `Skipped agents (${plan.skipped.length})`), safeWidth, theme));
		if (plan.skipped.length === 0) lines.push(renderBoxedLine(theme.fg("muted", "None."), safeWidth, theme));
		else for (const member of plan.skipped) this.pushWrapped(lines, `- ${member.job.name}: ${member.reason ?? "not runnable"}`, safeWidth);
		if (plan.largeWarning) lines.push(renderBoxedLine(theme.fg("warning", `Large group warning: this order contains ${plan.group.jobs.length} agents.`), safeWidth, theme));
	}

	private pushWrapped(lines: string[], text: string, safeWidth: number): void {
		for (const line of wrapPlainLine(text, Math.max(10, safeWidth - 4))) {
			lines.push(renderBoxedLine(`  ${this.options.theme.fg("text", line)}`, safeWidth, this.options.theme));
		}
	}

	invalidate(): void {}
}
