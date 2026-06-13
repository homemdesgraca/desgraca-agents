import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { AgentJob } from "../agents/agent-job.ts";
import type { AgentStore } from "../agents/agent-store.ts";
import { discoverArtifacts, type AgentRunner } from "../agents/agent-runner.ts";
import { DASHBOARD_HELP_TEXT, parseDashboardAction } from "./keybindings.ts";
import {
	clampLine,
	renderApprovals,
	renderArtifactContent,
	renderArtifacts,
	renderBottomBorder,
	renderBoxedLine,
	renderDivider,
	renderFooterHints,
	renderHeader,
	renderHelp,
	renderJobDetails,
	renderJobList,
	renderLogs,
	renderModeTabs,
	renderSectionTitle,
	renderTopBorder,
	splitColumns,
	type DashboardMode,
} from "./render.ts";

export interface DashboardActions {
	createJob(): Promise<void>;
	close(): void;
	notify(message: string, level?: "info" | "warning" | "error"): void;
}

export class Dashboard implements Component {
	private mode: DashboardMode = "normal";
	private artifactPreviewIndex: number | undefined;
	private notice: { message: string; level: "info" | "warning" | "error" } | undefined;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly store: AgentStore,
		private readonly runner: AgentRunner,
		private readonly actions: DashboardActions,
		private readonly tui: { requestRender: () => void },
		private readonly theme?: Theme,
	) {
		this.unsubscribe = this.store.subscribe(() => {
			this.invalidate();
			this.tui.requestRender();
		});
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		if (this.noticeTimer) clearTimeout(this.noticeTimer);
		this.noticeTimer = undefined;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(data: string): void {
		const action = parseDashboardAction(data);
		if (!action) return;

		if (action.type === "close") {
			this.dispose();
			this.actions.close();
			return;
		}

		if (action.type === "select") {
			if (this.mode === "artifacts") this.artifactPreviewIndex = action.index;
			else this.store.selectByIndex(action.index);
			this.invalidateAndRender();
			return;
		}

		void this.handleAction(action.type);
	}

	private async handleAction(type: Exclude<ReturnType<typeof parseDashboardAction>, undefined>["type"]): Promise<void> {
		const job = this.store.getSelected();
		switch (type) {
			case "create":
				await this.actions.createJob();
				break;
			case "start":
				if (!job) this.showNotice("Create or select a job first.", "warning");
				else await this.runner.start(job.id);
				break;
			case "abort":
				if (job) this.runner.abort(job.id);
				break;
			case "approve":
				this.resolveFirstApproval(job, "approved");
				break;
			case "deny":
				this.resolveFirstApproval(job, "denied");
				break;
			case "logs":
				this.mode = "logs";
				break;
			case "approvals":
				this.mode = "approvals";
				break;
			case "artifacts":
				this.mode = "artifacts";
				this.artifactPreviewIndex = undefined;
				break;
			case "help":
				this.mode = "help";
				break;
			case "normal":
				this.mode = "normal";
				this.artifactPreviewIndex = undefined;
				break;
			case "refresh":
				await this.refreshArtifacts(job);
				break;
		}
		this.invalidateAndRender();
	}

	private resolveFirstApproval(job: AgentJob | undefined, status: "approved" | "denied"): void {
		const approval = job?.pendingApprovals.find((item) => item.status === "pending");
		if (!job || !approval) {
			this.showNotice("No pending approval selected.", "warning");
			return;
		}
		this.store.resolveApproval(job.id, approval.id, status);
	}

	private async refreshArtifacts(job: AgentJob | undefined): Promise<void> {
		if (!job) {
			this.showNotice("No selected job.", "warning");
			return;
		}
		this.store.setArtifacts(job.id, await discoverArtifacts(job));
		this.store.appendLog(job.id, "Artifacts refreshed.");
	}

	private showNotice(message: string, level: "info" | "warning" | "error" = "info"): void {
		this.notice = { message, level };
		if (this.noticeTimer) clearTimeout(this.noticeTimer);
		this.noticeTimer = setTimeout(() => {
			this.notice = undefined;
			this.noticeTimer = undefined;
			this.invalidateAndRender();
		}, 3500);
		this.invalidateAndRender();
	}

	private invalidateAndRender(): void {
		this.invalidate();
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const safeWidth = Math.max(20, width);
		const jobs = this.store.list();
		const selected = this.store.getSelected();
		const selectedId = selected?.id;
		const theme = this.theme;
		const lines: string[] = [];
		const innerWidth = Math.max(1, safeWidth - 2);
		const leftWidth = Math.max(24, Math.floor(innerWidth * 0.38));
		const rightWidth = Math.max(10, innerWidth - leftWidth - 3);

		lines.push(renderTopBorder(safeWidth, " Agent control dashboard ", theme));
		for (const line of renderHeader(innerWidth, this.mode, theme, selected)) lines.push(renderBoxedLine(line, safeWidth, theme));
		for (const line of renderModeTabs(this.mode, innerWidth, theme)) lines.push(renderBoxedLine(line, safeWidth, theme));
		if (this.notice) {
			const color = this.notice.level === "error" ? "error" : this.notice.level === "warning" ? "warning" : "accent";
			lines.push(renderBoxedLine(theme ? theme.fg(color, this.notice.message) : this.notice.message, safeWidth, theme));
		}
		lines.push(renderDivider(safeWidth, theme));

		const left = [renderSectionTitle("Agents", leftWidth, theme), ...renderJobList(jobs, selectedId, leftWidth, theme)];
		let right: string[];
		if (this.mode === "logs") right = [renderSectionTitle("Logs", rightWidth, theme), ...renderLogs(selected, rightWidth, 18, theme, { wrap: true })];
		else if (this.mode === "approvals") right = [renderSectionTitle("Approvals", rightWidth, theme), ...renderApprovals(selected, rightWidth, theme)];
		else if (this.mode === "artifacts") {
			const artifact = selected?.artifacts[this.artifactPreviewIndex ?? -1];
			right = [
				renderSectionTitle("Artifacts", rightWidth, theme),
				...renderArtifacts(selected, rightWidth, theme),
				...(artifact ? ["", renderSectionTitle("Preview", rightWidth, theme)] : []),
				...renderArtifactContent(artifact, rightWidth, 18, theme),
			];
		} else if (this.mode === "help") right = [renderSectionTitle("Help", rightWidth, theme), ...renderHelp(rightWidth, theme)];
		else {
			right = [
				renderSectionTitle("Agent description", rightWidth, theme),
				...renderJobDetails(selected, rightWidth, theme),
				"",
				renderSectionTitle("Recent logs", rightWidth, theme),
				...renderLogs(selected, rightWidth, 6, theme),
			];
		}
		const minPaneRows = 22;
		while (left.length < minPaneRows) left.push("");
		while (right.length < minPaneRows) right.push("");
		for (const line of splitColumns(left, right, innerWidth, theme)) lines.push(renderBoxedLine(line, safeWidth, theme));
		lines.push(renderDivider(safeWidth, theme));
		for (const line of renderFooterHints(innerWidth, theme)) lines.push(renderBoxedLine(line, safeWidth, theme));
		lines.push(renderBoxedLine(clampLine(DASHBOARD_HELP_TEXT, innerWidth), safeWidth, theme));
		lines.push(renderBottomBorder(safeWidth, theme));

		this.cachedLines = lines.map((line) => clampLine(line, safeWidth));
		this.cachedWidth = width;
		return this.cachedLines;
	}
}
