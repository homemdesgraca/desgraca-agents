import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Input, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { AgentModelSelection } from "../agents/agent-job.ts";
import { clampLine, padLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export interface CreateJobDialogResult {
	name: string;
	task: string;
	model?: AgentModelSelection;
}

export interface CreateJobDialogInitialValue {
	name?: string;
	task?: string;
	model?: AgentModelSelection;
	title?: string;
	description?: string;
}

type ActiveField = "name" | "model" | "task";

export class CreateJobDialog implements Component, Focusable {
	private readonly nameInput = new Input();
	private readonly taskEditor: Editor;
	private activeField: ActiveField = "name";
	private selectedModelIndex = 0;
	private errorMessage: string | undefined;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (result: CreateJobDialogResult | undefined) => void,
		private readonly modelOptions: AgentModelSelection[] = [],
		private readonly initial: CreateJobDialogInitialValue = {},
	) {
		this.taskEditor = new Editor(
			tui,
			{
				borderColor: (text: string) => theme.fg("borderMuted", text),
				selectList: getSelectListTheme(),
			},
			{ paddingX: 0 },
		);
		if (initial.name) this.nameInput.setValue(initial.name);
		if (initial.task) this.taskEditor.setText(initial.task);
		if (initial.model) {
			const index = modelOptions.findIndex((model) => model.provider === initial.model?.provider && model.id === initial.model?.id);
			if (index >= 0) this.selectedModelIndex = index;
		}
		this.nameInput.onSubmit = () => this.focusNext();
		this.taskEditor.onSubmit = (task) => this.submit(task);
		this.syncFocus();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.syncFocus();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, "tab")) {
			this.focusNext();
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.focusPrevious();
			return;
		}

		if (this.activeField === "name") this.nameInput.handleInput(data);
		else if (this.activeField === "model") this.handleModelInput(data);
		else this.taskEditor.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(40, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const inputWidth = Math.max(8, innerWidth - 8);
		const output: string[] = [renderTopBorder(safeWidth, this.initial.title ?? " Create agent job ", this.theme)];

		output.push(renderBoxedLine(this.theme.fg("muted", this.initial.description ?? "Create a narrow, isolated worker. Fields start empty; Esc or Ctrl+C cancels."), safeWidth, this.theme));
		if (this.errorMessage) output.push(renderBoxedLine(this.theme.fg("warning", this.errorMessage), safeWidth, this.theme));
		output.push(renderDivider(safeWidth, this.theme));

		const nameLabel = this.activeField === "name" ? this.theme.fg("accent", "Name") : this.theme.fg("dim", "Name");
		const nameLine = this.nameInput.render(inputWidth)[0] ?? "";
		output.push(renderBoxedLine(`${padLine(`${nameLabel}:`, 7)}${nameLine}`, safeWidth, this.theme));
		output.push(renderBoxedLine(this.theme.fg("dim", "Use a short job name, for example api-cleanup-worker."), safeWidth, this.theme));

		output.push(renderDivider(safeWidth, this.theme));
		const modelLabel = this.activeField === "model" ? this.theme.fg("accent", "Model") : this.theme.fg("dim", "Model");
		const selectedModel = this.getSelectedModel();
		const modelValue = selectedModel ? `${selectedModel.provider}/${selectedModel.id}` : "Use current pi default model";
		const modelCount = this.modelOptions.length > 1 ? this.theme.fg("dim", ` (${this.selectedModelIndex + 1}/${this.modelOptions.length})`) : "";
		output.push(renderBoxedLine(`${padLine(`${modelLabel}:`, 8)}${this.theme.fg("text", modelValue)}${modelCount}`, safeWidth, this.theme));
		const modelHelp = this.modelOptions.length > 1 ? "Use Left/Right or Up/Down while focused here to choose the worker model." : "No alternate authenticated models found; this worker will use pi's current/default model.";
		output.push(renderBoxedLine(this.theme.fg("dim", modelHelp), safeWidth, this.theme));

		output.push(renderDivider(safeWidth, this.theme));
		const taskLabel = this.activeField === "task" ? this.theme.fg("accent", "Task") : this.theme.fg("dim", "Task");
		output.push(renderBoxedLine(`${taskLabel}:`, safeWidth, this.theme));
		for (const line of this.taskEditor.render(Math.max(1, innerWidth - 2))) {
			output.push(renderBoxedLine(` ${line}`, safeWidth, this.theme));
		}

		output.push(renderDivider(safeWidth, this.theme));
		output.push(
			renderBoxedLine(
				`${this.theme.fg("accent", "Tab")} switch fields  ${this.theme.fg("accent", "←/→")} choose model  ${this.theme.fg("accent", "Enter")} next/submit  ${this.theme.fg("accent", "Esc/Ctrl+C")} cancel`,
				safeWidth,
				this.theme,
			),
		);
		output.push(renderBottomBorder(safeWidth, this.theme));
		return output.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {
		this.nameInput.invalidate();
		this.taskEditor.invalidate();
	}

	private handleModelInput(data: string): void {
		if (matchesKey(data, "enter")) {
			this.focusTask();
			return;
		}
		if (matchesKey(data, "left") || matchesKey(data, "up")) {
			this.cycleModel(-1);
			return;
		}
		if (matchesKey(data, "right") || matchesKey(data, "down")) {
			this.cycleModel(1);
		}
	}

	private cycleModel(delta: number): void {
		if (this.modelOptions.length <= 1) return;
		this.selectedModelIndex = (this.selectedModelIndex + delta + this.modelOptions.length) % this.modelOptions.length;
		this.errorMessage = undefined;
	}

	private focusNext(): void {
		this.activeField = this.activeField === "name" ? "model" : this.activeField === "model" ? "task" : "name";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private focusPrevious(): void {
		this.activeField = this.activeField === "task" ? "model" : this.activeField === "model" ? "name" : "task";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private focusTask(): void {
		this.activeField = "task";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private getSelectedModel(): AgentModelSelection | undefined {
		return this.modelOptions[this.selectedModelIndex];
	}

	private submit(submittedTask?: string): void {
		const name = this.nameInput.getValue().trim();
		const task = (submittedTask ?? this.taskEditor.getExpandedText()).trim();
		if (!name) {
			this.errorMessage = "Agent job name is required.";
			this.activeField = "name";
			this.syncFocus();
			this.tui.requestRender();
			return;
		}
		if (!task) {
			this.errorMessage = "Agent task is required.";
			this.activeField = "task";
			this.syncFocus();
			this.tui.requestRender();
			return;
		}
		this.done({ name, task, model: this.getSelectedModel() });
	}

	private syncFocus(): void {
		this.nameInput.focused = this._focused && this.activeField === "name";
		this.taskEditor.focused = this._focused && this.activeField === "task";
	}
}
