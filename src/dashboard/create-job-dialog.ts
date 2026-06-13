import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Input, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { clampLine, padLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export interface CreateJobDialogResult {
	name: string;
	task: string;
}

type ActiveField = "name" | "task";

export class CreateJobDialog implements Component, Focusable {
	private readonly nameInput = new Input();
	private readonly taskEditor: Editor;
	private activeField: ActiveField = "name";
	private errorMessage: string | undefined;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (result: CreateJobDialogResult | undefined) => void,
	) {
		this.taskEditor = new Editor(
			tui,
			{
				borderColor: (text: string) => theme.fg("borderMuted", text),
				selectList: getSelectListTheme(),
			},
			{ paddingX: 0 },
		);
		this.nameInput.onSubmit = () => this.focusTask();
		this.taskEditor.onSubmit = () => this.submit();
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
		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			this.activeField = this.activeField === "name" ? "task" : "name";
			this.errorMessage = undefined;
			this.syncFocus();
			this.tui.requestRender();
			return;
		}

		if (this.activeField === "name") this.nameInput.handleInput(data);
		else this.taskEditor.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(40, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const inputWidth = Math.max(8, innerWidth - 8);
		const output: string[] = [renderTopBorder(safeWidth, " Create agent job ", this.theme)];

		output.push(renderBoxedLine(this.theme.fg("muted", "Create a narrow, isolated worker. Fields start empty; Esc or Ctrl+C cancels."), safeWidth, this.theme));
		if (this.errorMessage) output.push(renderBoxedLine(this.theme.fg("warning", this.errorMessage), safeWidth, this.theme));
		output.push(renderDivider(safeWidth, this.theme));

		const nameLabel = this.activeField === "name" ? this.theme.fg("accent", "Name") : this.theme.fg("dim", "Name");
		const nameLine = this.nameInput.render(inputWidth)[0] ?? "";
		output.push(renderBoxedLine(`${padLine(`${nameLabel}:`, 7)}${nameLine}`, safeWidth, this.theme));
		output.push(renderBoxedLine(this.theme.fg("dim", "Use a short job name, for example api-cleanup-worker."), safeWidth, this.theme));

		output.push(renderDivider(safeWidth, this.theme));
		const taskLabel = this.activeField === "task" ? this.theme.fg("accent", "Task") : this.theme.fg("dim", "Task");
		output.push(renderBoxedLine(`${taskLabel}:`, safeWidth, this.theme));
		for (const line of this.taskEditor.render(Math.max(1, innerWidth - 2))) {
			output.push(renderBoxedLine(` ${line}`, safeWidth, this.theme));
		}

		output.push(renderDivider(safeWidth, this.theme));
		output.push(
			renderBoxedLine(
				`${this.theme.fg("accent", "Tab")} switch fields  ${this.theme.fg("accent", "Enter")} next/submit  ${this.theme.fg("accent", "Shift+Enter")} newline  ${this.theme.fg("accent", "Esc/Ctrl+C")} cancel`,
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

	private focusTask(): void {
		this.activeField = "task";
		this.errorMessage = undefined;
		this.syncFocus();
		this.tui.requestRender();
	}

	private submit(): void {
		const name = this.nameInput.getValue().trim();
		const task = this.taskEditor.getExpandedText().trim();
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
		this.done({ name, task });
	}

	private syncFocus(): void {
		this.nameInput.focused = this._focused && this.activeField === "name";
		this.taskEditor.focused = this._focused && this.activeField === "task";
	}
}
