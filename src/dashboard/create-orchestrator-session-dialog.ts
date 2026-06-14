import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Input, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { AgentModelSelection } from "../agents/agent-job.ts";
import { clampLine, padLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export interface CreateOrchestratorSessionDialogResult {
	title: string;
	initialPrompt?: string;
	model?: AgentModelSelection;
}

type ActiveField = "title" | "model" | "prompt";

export class CreateOrchestratorSessionDialog implements Component, Focusable {
	private readonly titleInput = new Input();
	private readonly promptEditor: Editor;
	private activeField: ActiveField = "title";
	private selectedModelIndex = 0;
	private errorMessage: string | undefined;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (result: CreateOrchestratorSessionDialogResult | undefined) => void,
		private readonly modelOptions: AgentModelSelection[] = [],
	) {
		this.promptEditor = new Editor(tui, { borderColor: (text: string) => theme.fg("borderMuted", text), selectList: getSelectListTheme() }, { paddingX: 0 });
		this.titleInput.onSubmit = () => this.focusNext();
		this.promptEditor.onSubmit = (prompt) => this.submit(prompt);
		this.syncFocus();
	}

	get focused(): boolean { return this._focused; }
	set focused(value: boolean) { this._focused = value; this.syncFocus(); }

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.done(undefined);
		if (matchesKey(data, "tab")) return this.focusNext();
		if (matchesKey(data, "shift+tab")) return this.focusPrevious();
		if (this.activeField === "title") this.titleInput.handleInput(data);
		else if (this.activeField === "model") this.handleModelInput(data);
		else this.promptEditor.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(44, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const inputWidth = Math.max(8, innerWidth - 9);
		const output = [renderTopBorder(safeWidth, " Create orchestrator session ", this.theme)];
		output.push(renderBoxedLine(this.theme.fg("muted", "Create a planning/control session. The model is used by this orchestrator only."), safeWidth, this.theme));
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
		const promptLabel = this.activeField === "prompt" ? this.theme.fg("accent", "Initial prompt") : this.theme.fg("dim", "Initial prompt");
		output.push(renderBoxedLine(`${promptLabel}:`, safeWidth, this.theme));
		for (const line of this.promptEditor.render(Math.max(1, innerWidth - 2))) output.push(renderBoxedLine(` ${line}`, safeWidth, this.theme));
		output.push(renderDivider(safeWidth, this.theme));
		output.push(renderBoxedLine(`${this.theme.fg("accent", "Tab")} switch fields  ${this.theme.fg("accent", "←/→")} choose model  ${this.theme.fg("accent", "Enter")} next/submit  ${this.theme.fg("accent", "Esc/Ctrl+C")} cancel`, safeWidth, this.theme));
		output.push(renderBottomBorder(safeWidth, this.theme));
		return output.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {
		this.titleInput.invalidate();
		this.promptEditor.invalidate();
	}

	private handleModelInput(data: string): void {
		if (matchesKey(data, "enter")) return this.focusPrompt();
		if (matchesKey(data, "left") || matchesKey(data, "up")) this.cycleModel(-1);
		if (matchesKey(data, "right") || matchesKey(data, "down")) this.cycleModel(1);
	}

	private cycleModel(delta: number): void {
		if (this.modelOptions.length <= 1) return;
		this.selectedModelIndex = (this.selectedModelIndex + delta + this.modelOptions.length) % this.modelOptions.length;
		this.errorMessage = undefined;
	}

	private focusNext(): void {
		this.activeField = this.activeField === "title" ? "model" : this.activeField === "model" ? "prompt" : "title";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private focusPrevious(): void {
		this.activeField = this.activeField === "prompt" ? "model" : this.activeField === "model" ? "title" : "prompt";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private focusPrompt(): void {
		this.activeField = "prompt";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private getSelectedModel(): AgentModelSelection | undefined {
		return this.modelOptions[this.selectedModelIndex];
	}

	private submit(submittedPrompt?: string): void {
		const title = this.titleInput.getValue().trim();
		const initialPrompt = (submittedPrompt ?? this.promptEditor.getExpandedText()).trim();
		if (!title) {
			this.errorMessage = "Session title is required.";
			this.activeField = "title";
			this.syncFocus();
			this.tui.requestRender();
			return;
		}
		this.done({ title, initialPrompt: initialPrompt || undefined, model: this.getSelectedModel() });
	}

	private syncFocus(): void {
		this.titleInput.focused = this._focused && this.activeField === "title";
		this.promptEditor.focused = this._focused && this.activeField === "prompt";
	}
}
