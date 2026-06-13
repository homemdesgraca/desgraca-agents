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
	renderHeader,
	renderHelp,
	renderJobDetails,
	renderJobList,
	renderLogs,
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
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly store: AgentStore,
		private readonly runner: AgentRunner,
		private readonly actions: DashboardActions,
		private readonly tui: { requestRender: () => void },
	) {
		this.unsubscribe = this.store.subscribe(() => {
			this.invalidate();
			this.tui.requestRender();
		});
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
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
				if (!job) this.actions.notify("Create or select a job first.", "warning");
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
			this.actions.notify("No pending approval selected.", "warning");
			return;
		}
		this.store.resolveApproval(job.id, approval.id, status);
	}

	private async refreshArtifacts(job: AgentJob | undefined): Promise<void> {
		if (!job) {
			this.actions.notify("No selected job.", "warning");
			return;
		}
		this.store.setArtifacts(job.id, await discoverArtifacts(job));
		this.store.appendLog(job.id, "Artifacts refreshed.");
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
		const lines: string[] = [];

		lines.push(...renderHeader(safeWidth, this.mode));
		lines.push(clampLine("".padEnd(Math.min(safeWidth, 120), "─"), safeWidth));

		const left = ["Agents", ...renderJobList(jobs, selectedId, Math.floor(safeWidth * 0.38))];
		let right: string[];
		if (this.mode === "logs") right = ["Logs", ...renderLogs(selected, Math.floor(safeWidth * 0.58), 18)];
		else if (this.mode === "approvals") right = ["Approvals", ...renderApprovals(selected, Math.floor(safeWidth * 0.58))];
		else if (this.mode === "artifacts") {
			const artifact = selected?.artifacts[this.artifactPreviewIndex ?? -1];
			right = ["Artifacts", ...renderArtifacts(selected, Math.floor(safeWidth * 0.58)), ...renderArtifactContent(artifact, Math.floor(safeWidth * 0.58))];
		} else if (this.mode === "help") right = ["Help", ...renderHelp(Math.floor(safeWidth * 0.58))];
		else right = ["Selected agent", ...renderJobDetails(selected, Math.floor(safeWidth * 0.58)), "", "Recent logs", ...renderLogs(selected, Math.floor(safeWidth * 0.58), 6)];
		lines.push(...splitColumns(left, right, safeWidth));
		lines.push(clampLine("".padEnd(Math.min(safeWidth, 120), "─"), safeWidth));
		lines.push(clampLine(DASHBOARD_HELP_TEXT, safeWidth));

		this.cachedLines = lines.map((line) => clampLine(line, safeWidth));
		this.cachedWidth = width;
		return this.cachedLines;
	}
}
