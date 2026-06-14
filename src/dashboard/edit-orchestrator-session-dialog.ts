import { type Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { AgentModelSelection } from "../agents/agent-job.ts";
import type { OrchestratorSession } from "../orchestrator/orchestrator-session.ts";
import { clampLine, padLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export interface EditOrchestratorSessionDialogResult {
	title: string;
	model?: AgentModelSelection;
}

type ActiveField = "title" | "model";

export class EditOrchestratorSessionDialog implements Component, Focusable {
	private readonly titleInput = new Input();
	private activeField: ActiveField = "title";
	private selectedModelIndex = 0;
	private errorMessage: string | undefined;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (result: EditOrchestratorSessionDialogResult | undefined) => void,
		private readonly session: OrchestratorSession,
		private readonly modelOptions: AgentModelSelection[] = [],
	) {
		this.titleInput.setValue(session.title);
		this.titleInput.onSubmit = () => this.focusModel();
		const currentModelIndex = session.model ? modelOptions.findIndex((model) => model.provider === session.model?.provider && model.id === session.model?.id) : -1;
		this.selectedModelIndex = Math.max(0, currentModelIndex);
		this.syncFocus();
	}

	get focused(): boolean { return this._focused; }
	set focused(value: boolean) { this._focused = value; this.syncFocus(); }

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.done(undefined);
		if (matchesKey(data, "tab")) return this.focusNext();
		if (matchesKey(data, "shift+tab")) return this.focusPrevious();
		if (this.activeField === "title") this.titleInput.handleInput(data);
		else this.handleModelInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(44, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const inputWidth = Math.max(8, innerWidth - 9);
		const output = [renderTopBorder(safeWidth, " Edit orchestrator session ", this.theme)];
		output.push(renderBoxedLine(this.theme.fg("muted", "Edit the active orchestrator session title and model."), safeWidth, this.theme));
		if (this.errorMessage) output.push(renderBoxedLine(this.theme.fg("warning", this.errorMessage), safeWidth, this.theme));
		output.push(renderDivider(safeWidth, this.theme));
		const titleLabel = this.activeField === "title" ? this.theme.fg("accent", "Title") : this.theme.fg("dim", "Title");
		output.push(renderBoxedLine(`${padLine(`${titleLabel}:`, 8)}${this.titleInput.render(inputWidth)[0] ?? ""}`, safeWidth, this.theme));
		output.push(renderDivider(safeWidth, this.theme));
		const modelLabel = this.activeField === "model" ? this.theme.fg("accent", "Model") : this.theme.fg("dim", "Model");
		const selectedModel = this.getSelectedModel();
		const modelValue = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : "Use current/default model";
		output.push(renderBoxedLine(`${padLine(`${modelLabel}:`, 8)}${this.theme.fg("text", modelValue)}${this.modelOptions.length > 1 ? this.theme.fg("dim", ` (${this.selectedModelIndex + 1}/${this.modelOptions.length})`) : ""}`, safeWidth, this.theme));
		output.push(renderBoxedLine(this.theme.fg("dim", "Use Left/Right or Up/Down while focused here to choose the orchestrator model."), safeWidth, this.theme));
		output.push(renderDivider(safeWidth, this.theme));
		output.push(renderBoxedLine(`${this.theme.fg("accent", "Tab")} switch fields  ${this.theme.fg("accent", "S/Enter")} save  ${this.theme.fg("accent", "Esc/Ctrl+C")} cancel`, safeWidth, this.theme));
		output.push(renderBottomBorder(safeWidth, this.theme));
		return output.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {
		this.titleInput.invalidate();
	}

	private handleModelInput(data: string): void {
		if (matchesKey(data, "enter") || data === "s" || data === "S") return this.submit();
		if (matchesKey(data, "left") || matchesKey(data, "up")) this.cycleModel(-1);
		if (matchesKey(data, "right") || matchesKey(data, "down")) this.cycleModel(1);
	}

	private cycleModel(delta: number): void {
		if (this.modelOptions.length <= 1) return;
		this.selectedModelIndex = (this.selectedModelIndex + delta + this.modelOptions.length) % this.modelOptions.length;
		this.errorMessage = undefined;
	}

	private focusNext(): void {
		this.activeField = this.activeField === "title" ? "model" : "title";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private focusPrevious(): void {
		this.focusNext();
	}

	private focusModel(): void {
		this.activeField = "model";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private getSelectedModel(): AgentModelSelection | undefined {
		return this.modelOptions[this.selectedModelIndex] ?? this.session.model;
	}

	private submit(): void {
		const title = this.titleInput.getValue().trim();
		if (!title) {
			this.errorMessage = "Session title is required.";
			this.activeField = "title";
			this.syncFocus();
			this.tui.requestRender();
			return;
		}
		this.done({ title, model: this.getSelectedModel() });
	}

	private syncFocus(): void {
		this.titleInput.focused = this._focused && this.activeField === "title";
	}
}
