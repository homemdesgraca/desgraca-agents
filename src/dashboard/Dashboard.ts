import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { AgentArtifact, AgentJob } from "../agents/agent-job.ts";
import type { AgentStore } from "../agents/agent-store.ts";
import { discoverArtifacts, type AgentRunner } from "../agents/agent-runner.ts";
import type { OrchestratorRunner } from "../orchestrator/orchestrator-runner.ts";
import type { OrchestratorSessionSnapshot } from "../orchestrator/orchestrator-session.ts";
import type { OrchestratorStore } from "../orchestrator/orchestrator-store.ts";
import { DASHBOARD_HELP_TEXT, parseDashboardAction } from "./keybindings.ts";
import {
	clampLine,
	renderApprovals,
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
	renderTracking,
	splitColumns,
	type DashboardMode,
} from "./render.ts";
import { renderOrchestratorLeft, renderOrchestratorRight } from "./render-orchestrator.ts";

export interface DashboardActions {
	createJob(): Promise<void>;
	close(): void;
	notify(message: string, level?: "info" | "warning" | "error"): void;
	deleteJob(job: AgentJob): Promise<boolean>;
	clearJob(job: AgentJob): Promise<boolean>;
	editJob?(job: AgentJob): Promise<void>;
	sendMessage(job: AgentJob): Promise<void>;
	openArtifactViewer(job: AgentJob, artifact: AgentArtifact): Promise<void>;
	createOrchestratorSession?(): Promise<void>;
	sendOrchestratorMessage?(sessionId: string): Promise<void>;
	approveOrchestratorStartRequest?(sessionId: string, requestId: string): Promise<void>;
	denyOrchestratorStartRequest?(sessionId: string, requestId: string): Promise<void>;
	editOrchestratorSession?(sessionId: string): Promise<void>;
	clearOrchestratorSession?(sessionId: string): Promise<boolean>;
	deleteOrchestratorSession?(sessionId: string): Promise<boolean>;
	refreshOrchestratorState?(): Promise<void>;
}

const MODE_ORDER: DashboardMode[] = ["normal", "orchestrator", "logs", "approvals", "artifacts", "help"];

export class Dashboard implements Component {
	private mode: DashboardMode = "normal";
	private artifactPreviewIndex = 0;
	private showArtifactNotes = true;
	private rightScrollOffset = 0;
	private autoScrollEnabled = true;
	private notice: { message: string; level: "info" | "warning" | "error" } | undefined;
	private noticeTimer: ReturnType<typeof setTimeout> | undefined;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private unsubscribe: (() => void) | undefined;
	private orchestratorUnsubscribe: (() => void) | undefined;
	private orchestratorRefreshTimer: ReturnType<typeof setInterval> | undefined;
	private orchestratorSnapshot: OrchestratorSessionSnapshot | undefined;

	constructor(
		private readonly store: AgentStore,
		private readonly runner: AgentRunner,
		private readonly actions: DashboardActions,
		private readonly tui: { requestRender: () => void },
		private readonly theme?: Theme,
		private readonly orchestratorStore?: OrchestratorStore,
		private readonly orchestratorRunner?: OrchestratorRunner,
	) {
		this.unsubscribe = this.store.subscribe(() => {
			if (this.shouldAutoScrollRight()) this.rightScrollOffset = Number.MAX_SAFE_INTEGER;
			void this.refreshOrchestratorSnapshot();
			this.invalidate();
			this.tui.requestRender();
		});
		this.orchestratorUnsubscribe = this.orchestratorStore?.subscribe(() => {
			if (this.shouldAutoScrollRight()) this.rightScrollOffset = Number.MAX_SAFE_INTEGER;
			void this.refreshOrchestratorSnapshot();
			this.invalidate();
			this.tui.requestRender();
		});
		if (this.orchestratorStore) {
			this.orchestratorRefreshTimer = setInterval(() => {
				const refresh = this.actions.refreshOrchestratorState?.() ?? this.orchestratorStore!.refresh();
				void refresh.then(() => {
					if (this.shouldAutoScrollRight()) this.rightScrollOffset = Number.MAX_SAFE_INTEGER;
					return this.refreshOrchestratorSnapshot();
				}).then(() => this.invalidateAndRender()).catch(() => undefined);
			}, 1500);
			void this.refreshOrchestratorSnapshot();
		}
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.orchestratorUnsubscribe?.();
		this.orchestratorUnsubscribe = undefined;
		if (this.orchestratorRefreshTimer) clearInterval(this.orchestratorRefreshTimer);
		this.orchestratorRefreshTimer = undefined;
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
			if (this.mode === "orchestrator") {
				this.orchestratorStore?.selectByIndex(action.index);
				void this.refreshOrchestratorSnapshot();
			} else {
				this.store.selectByIndex(action.index);
			}
			this.artifactPreviewIndex = 0;
			this.rightScrollOffset = 0;
			this.invalidateAndRender();
			return;
		}

		void this.handleAction(action.type);
	}

	private async handleAction(type: Exclude<ReturnType<typeof parseDashboardAction>, undefined>["type"]): Promise<void> {
		const job = this.store.getSelected();
		switch (type) {
			case "scrollUp":
				this.autoScrollEnabled = false;
				this.rightScrollOffset = Math.max(0, this.rightScrollOffset - 1);
				break;
			case "scrollDown":
				this.autoScrollEnabled = false;
				this.rightScrollOffset += 1;
				break;
			case "scrollTop":
				this.autoScrollEnabled = false;
				this.rightScrollOffset = 0;
				break;
			case "scrollBottom":
				this.autoScrollEnabled = false;
				this.rightScrollOffset = Number.MAX_SAFE_INTEGER;
				break;
			case "toggleAutoScroll":
				this.autoScrollEnabled = !this.autoScrollEnabled;
				if (this.autoScrollEnabled) this.rightScrollOffset = Number.MAX_SAFE_INTEGER;
				this.showNotice(this.autoScrollEnabled ? "Auto-scroll enabled." : "Auto-scroll disabled.", "info");
				break;
			case "create":
				if (this.mode === "orchestrator") {
					await this.actions.createOrchestratorSession?.();
					await this.refreshOrchestratorSnapshot();
					break;
				}
				if (!this.requireMode("normal", "Create is available in AGENTS mode. Press G first.")) break;
				await this.actions.createJob();
				break;
			case "clear":
				if (this.mode === "orchestrator") {
					const sessionId = this.orchestratorStore?.getSelectedId();
					if (!sessionId) this.showNotice("No orchestrator session selected.", "warning");
					else if (await this.actions.clearOrchestratorSession?.(sessionId)) {
						this.rightScrollOffset = 0;
						await this.refreshOrchestratorSnapshot();
						this.showNotice("Cleared orchestrator session.", "info");
					}
					break;
				}
				if (!this.requireMode("normal", "Clear is available in AGENTS mode. Press G first.")) break;
				if (!job) this.showNotice("No selected job.", "warning");
				else if (await this.actions.clearJob(job)) {
					if (this.runner.isRunning(job.id)) this.runner.abort(job.id);
					this.artifactPreviewIndex = 0;
					this.rightScrollOffset = 0;
					this.showNotice(`Cleared agent ${job.name}.`, "info");
				}
				break;
			case "start":
				if (this.mode === "orchestrator") {
					await this.resolveFirstOrchestratorStart("approved");
					break;
				}
				if (!this.requireMode("normal", "Start is available in AGENTS mode. Press G first.")) break;
				if (!job) this.showNotice("Create or select a job first.", "warning");
				else if (this.agentHasStartedOutput(job)) this.showNotice("This agent has already been started. Clear it first with K if you want to run it from a blank state.", "warning");
				else await this.runner.start(job.id);
				break;
			case "abort":
				if (this.mode === "orchestrator") {
					const sessionId = this.orchestratorStore?.getSelectedId();
					if (!sessionId) this.showNotice("No orchestrator session selected.", "warning");
					else if (!this.orchestratorRunner?.isRunning(sessionId)) this.showNotice("Selected orchestrator session is not running.", "warning");
					else {
						this.orchestratorRunner.abort(sessionId);
						this.showNotice("Aborted orchestrator session.", "info");
					}
					break;
				}
				if (!this.requireMode("normal", "Abort is available in AGENTS mode. Press G first.")) break;
				if (job) this.runner.abort(job.id);
				break;
			case "delete":
				if (this.mode === "orchestrator") {
					const sessionId = this.orchestratorStore?.getSelectedId();
					if (!sessionId) this.showNotice("No orchestrator session selected.", "warning");
					else if (await this.actions.deleteOrchestratorSession?.(sessionId)) {
						this.rightScrollOffset = 0;
						await this.refreshOrchestratorSnapshot();
						this.showNotice("Deleted orchestrator session.", "info");
					}
					break;
				}
				if (!this.requireMode("normal", "Delete is available in AGENTS mode. Press G first.")) break;
				if (!job) this.showNotice("No selected job.", "warning");
				else if (await this.actions.deleteJob(job)) {
					if (this.runner.isRunning(job.id)) this.runner.abort(job.id);
					this.rightScrollOffset = 0;
					this.showNotice(`Deleted agent ${job.name}.`, "info");
				}
				break;
			case "edit":
				if (this.mode === "orchestrator") {
					const sessionId = this.orchestratorStore?.getSelectedId();
					if (!sessionId) this.showNotice("No orchestrator session selected.", "warning");
					else await this.actions.editOrchestratorSession?.(sessionId);
					await this.refreshOrchestratorSnapshot();
					break;
				}
				if (!this.requireMode("normal", "Edit is available in AGENTS mode. Press G first.")) break;
				if (!job) this.showNotice("No selected job.", "warning");
				else if (this.agentHasStartedOutput(job)) this.showNotice("Only draft agents can be edited in this version.", "warning");
				else await this.actions.editJob?.(job);
				break;
			case "artifactPrevious":
				this.moveArtifactSelection(-1, job);
				break;
			case "artifactNext":
				this.moveArtifactSelection(1, job);
				break;
			case "artifactOpen":
				if (this.mode === "orchestrator") await this.resolveFirstOrchestratorStart("approved");
				else await this.openSelectedArtifact(job);
				break;
			case "toggleNotes":
				this.toggleArtifactNotes();
				break;
			case "message":
				if (this.mode === "orchestrator") {
					const sessionId = this.orchestratorStore?.getSelectedId();
					if (!sessionId) this.showNotice("Create or select an orchestrator session first.", "warning");
					else await this.actions.sendOrchestratorMessage?.(sessionId);
					await this.refreshOrchestratorSnapshot();
					break;
				}
				if (!this.requireMode("logs", "Messages are available in TRACKING mode. Press T first.")) break;
				if (!job) this.showNotice("No selected job.", "warning");
				else {
					this.rightScrollOffset = Number.MAX_SAFE_INTEGER;
					await this.actions.sendMessage(job);
				}
				break;
			case "approve":
				if (this.mode === "orchestrator") await this.resolveFirstOrchestratorStart("approved");
				else if (this.requireMode("approvals", "Approve is available in APPROVALS mode. Press P first.")) this.resolveFirstApproval(job, "approved");
				break;
			case "deny":
				if (this.mode === "orchestrator") await this.resolveFirstOrchestratorStart("denied");
				else if (this.requireMode("approvals", "Deny is available in APPROVALS mode. Press P first.")) this.resolveFirstApproval(job, "denied");
				break;
			case "logs":
				this.mode = "logs";
				this.rightScrollOffset = this.autoScrollEnabled ? Number.MAX_SAFE_INTEGER : 0;
				break;
			case "orchestrator":
				this.mode = "orchestrator";
				this.rightScrollOffset = this.autoScrollEnabled ? Number.MAX_SAFE_INTEGER : 0;
				await this.refreshOrchestratorSnapshot();
				break;
			case "approvals":
				this.mode = "approvals";
				this.rightScrollOffset = 0;
				break;
			case "artifacts":
				this.mode = "artifacts";
				this.artifactPreviewIndex = 0;
				this.rightScrollOffset = 0;
				break;
			case "help":
				this.mode = "help";
				this.rightScrollOffset = 0;
				break;
			case "normal":
				this.mode = "normal";
				this.artifactPreviewIndex = 0;
				this.rightScrollOffset = 0;
				break;
			case "previousMode":
				this.walkMode(-1);
				break;
			case "nextMode":
				this.walkMode(1);
				break;
			case "refresh":
				if (this.requireMode("artifacts", "Refresh is available in ARTIFACTS mode. Press F first.")) await this.refreshArtifacts(job);
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

	private async refreshOrchestratorSnapshot(): Promise<void> {
		const sessionId = this.orchestratorStore?.getSelectedId();
		this.orchestratorSnapshot = sessionId ? await this.orchestratorStore?.getSnapshot(sessionId) : undefined;
	}

	private async resolveFirstOrchestratorStart(status: "approved" | "denied"): Promise<void> {
		const sessionId = this.orchestratorStore?.getSelectedId();
		if (!sessionId) {
			this.showNotice("No orchestrator session selected.", "warning");
			return;
		}
		await this.refreshOrchestratorSnapshot();
		const request = this.orchestratorSnapshot?.startRequests.find((item) => item.status === "pending");
		if (!request) {
			this.showNotice("No pending orchestrator start request.", "warning");
			return;
		}
		if (status === "approved") await this.actions.approveOrchestratorStartRequest?.(sessionId, request.id);
		else await this.actions.denyOrchestratorStartRequest?.(sessionId, request.id);
		await this.refreshOrchestratorSnapshot();
	}

	private getVisibleArtifacts(job: AgentJob | undefined): AgentArtifact[] {
		if (!job) return [];
		return this.showArtifactNotes ? job.artifacts : job.artifacts.filter((artifact) => artifact.kind !== "note");
	}

	private toggleArtifactNotes(): void {
		if (this.mode !== "artifacts") {
			this.showNotice("Note visibility can be toggled in ARTIFACTS mode. Press F first.", "warning");
			return;
		}
		this.showArtifactNotes = !this.showArtifactNotes;
		this.artifactPreviewIndex = 0;
		this.rightScrollOffset = 0;
		this.showNotice(this.showArtifactNotes ? "Notes are visible in ARTIFACTS." : "Notes are hidden in ARTIFACTS.", "info");
	}

	private moveArtifactSelection(delta: number, job: AgentJob | undefined): void {
		if (this.mode !== "artifacts") {
			this.showNotice("Artifact navigation is only active in ARTIFACTS mode.", "warning");
			return;
		}
		const count = this.getVisibleArtifacts(job).length;
		if (count === 0) {
			this.showNotice(this.showArtifactNotes ? "No artifacts to select." : "No visible artifacts. Press V to show notes.", "warning");
			return;
		}
		this.artifactPreviewIndex = (this.artifactPreviewIndex + delta + count) % count;
		this.rightScrollOffset = 0;
	}

	private async openSelectedArtifact(job: AgentJob | undefined): Promise<void> {
		if (this.mode !== "artifacts") {
			this.showNotice("Artifact open is available in ARTIFACTS mode. Press F first.", "warning");
			return;
		}
		const artifacts = this.getVisibleArtifacts(job);
		if (!job || artifacts.length === 0) {
			this.showNotice(this.showArtifactNotes ? "No artifact selected." : "No visible artifact selected. Press V to show notes.", "warning");
			return;
		}
		this.artifactPreviewIndex = Math.min(this.artifactPreviewIndex, artifacts.length - 1);
		const artifact = artifacts[this.artifactPreviewIndex];
		if (!artifact) return;
		await this.actions.openArtifactViewer(job, artifact);
		this.rightScrollOffset = 0;
	}

	private requireMode(mode: DashboardMode, message: string): boolean {
		if (this.mode === mode) return true;
		this.showNotice(message, "warning");
		return false;
	}

	private walkMode(delta: number): void {
		const current = MODE_ORDER.indexOf(this.mode);
		const next = (current + delta + MODE_ORDER.length) % MODE_ORDER.length;
		this.mode = MODE_ORDER[next] ?? "normal";
		this.rightScrollOffset = this.shouldAutoScrollRight() ? Number.MAX_SAFE_INTEGER : 0;
	}

	private shouldAutoScrollRight(): boolean {
		return this.autoScrollEnabled && (this.mode === "logs" || this.mode === "orchestrator");
	}

	private agentHasStartedOutput(job: AgentJob): boolean {
		return !!job.startedAt || !!job.finalResponse || !!job.process || job.artifacts.length > 0 || job.pendingApprovals.length > 0 || job.status !== "draft";
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

		const left = this.mode === "orchestrator"
			? renderOrchestratorLeft(this.orchestratorStore?.list() ?? [], this.orchestratorStore?.getSelectedId(), this.orchestratorSnapshot, jobs, leftWidth, theme)
			: [renderSectionTitle("Agents", leftWidth, theme), ...renderJobList(jobs, selectedId, leftWidth, theme)];
		let rightTitleText: string;
		let right: string[];
		if (this.mode === "orchestrator") {
			rightTitleText = "Orchestrator";
			right = renderOrchestratorRight(this.orchestratorSnapshot, rightWidth, theme);
		} else if (this.mode === "logs") {
			rightTitleText = "Tracking";
			right = [renderSectionTitle(rightTitleText, rightWidth, theme), ...renderTracking(selected, rightWidth, theme)];
		} else if (this.mode === "approvals") {
			rightTitleText = "Approvals";
			right = [renderSectionTitle(rightTitleText, rightWidth, theme), ...renderApprovals(selected, rightWidth, theme)];
		}
		else if (this.mode === "artifacts") {
			rightTitleText = "Artifacts";
			const visibleArtifacts = this.getVisibleArtifacts(selected);
			const artifactCount = visibleArtifacts.length;
			if (artifactCount > 0) this.artifactPreviewIndex = Math.min(this.artifactPreviewIndex, artifactCount - 1);
			else this.artifactPreviewIndex = 0;
			const artifact = visibleArtifacts[this.artifactPreviewIndex];
			const noteCount = selected?.artifacts.filter((item) => item.kind === "note").length ?? 0;
			right = [
				renderSectionTitle(rightTitleText, rightWidth, theme),
				clampLine(`Notes: ${this.showArtifactNotes ? "shown" : "hidden"}${noteCount > 0 ? ` (${noteCount})` : ""}. Press V to toggle.`, rightWidth),
				...renderArtifacts(selected, rightWidth, theme, this.artifactPreviewIndex, { showNotes: this.showArtifactNotes }),
				...(artifactCount > 0 ? ["", clampLine("Use [ and ] to choose a visible item. Press Enter to open the large viewer.", rightWidth)] : []),
				...(artifact ? [
					"",
					renderSectionTitle("Selected artifact", rightWidth, theme),
					clampLine(`Path: ${artifact.path}`, rightWidth),
					clampLine(`Final path: ${artifact.originalPath ?? "(review-only artifact; no accept target)"}`, rightWidth),
					clampLine(`Type: ${artifact.kind === "proposal" ? "proposal" : artifact.kind === "note" ? "note" : "artifact"}`, rightWidth),
					clampLine(`Size: ${artifact.sizeBytes} bytes`, rightWidth),
				] : []),
			];
		} else if (this.mode === "help") {
			rightTitleText = "Help";
			right = [renderSectionTitle(rightTitleText, rightWidth, theme), ...renderHelp(rightWidth, theme)];
		} else {
			rightTitleText = "Agent description";
			right = [
				renderSectionTitle(rightTitleText, rightWidth, theme),
				...renderJobDetails(selected, rightWidth, theme),
				"",
				renderSectionTitle("Recent logs", rightWidth, theme),
				...renderLogs(selected, rightWidth, 6, theme),
			];
		}
		const minPaneRows = 22;
		const scrollableRows = Math.max(1, minPaneRows - 1);
		const rightTitle = right[0] ?? renderSectionTitle(rightTitleText, rightWidth, theme);
		const rightBody = right.slice(1);
		const maxScroll = Math.max(0, rightBody.length - scrollableRows);
		this.rightScrollOffset = Math.min(this.rightScrollOffset, maxScroll);
		const scrollInfo = maxScroll > 0 ? ` ${this.rightScrollOffset + 1}-${Math.min(rightBody.length, this.rightScrollOffset + scrollableRows)}/${rightBody.length}` : "";
		const visibleRight = [maxScroll > 0 ? renderSectionTitle(`${rightTitleText}${scrollInfo}`, rightWidth, theme) : rightTitle, ...rightBody.slice(this.rightScrollOffset, this.rightScrollOffset + scrollableRows)];
		while (left.length < minPaneRows) left.push("");
		while (visibleRight.length < minPaneRows) visibleRight.push("");
		for (const line of splitColumns(left, visibleRight, innerWidth, theme)) lines.push(renderBoxedLine(line, safeWidth, theme));
		lines.push(renderDivider(safeWidth, theme));
		for (const line of renderFooterHints(innerWidth, theme, this.mode)) lines.push(renderBoxedLine(line, safeWidth, theme));
		lines.push(renderBoxedLine(clampLine(DASHBOARD_HELP_TEXT, innerWidth), safeWidth, theme));
		lines.push(renderBottomBorder(safeWidth, theme));

		this.cachedLines = lines.map((line) => clampLine(line, safeWidth));
		this.cachedWidth = width;
		return this.cachedLines;
	}
}
