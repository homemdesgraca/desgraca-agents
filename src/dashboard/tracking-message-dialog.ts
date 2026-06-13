import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { clampLine, renderBottomBorder, renderBoxedLine, renderDivider, renderTopBorder } from "./render.ts";

export class TrackingMessageDialog implements Component, Focusable {
	private readonly editor: Editor;
	private _focused = false;

	constructor(
		tui: TUI,
		private readonly theme: Theme,
		private readonly done: (message: string | undefined) => void,
		private readonly agentName: string,
	) {
		this.editor = new Editor(tui, { borderColor: (text: string) => theme.fg("borderMuted", text), selectList: getSelectListTheme() }, { paddingX: 0 });
		this.editor.onSubmit = (message) => this.done(message.trim() || undefined);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.editor.focused = value;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done(undefined);
			return;
		}
		this.editor.handleInput(data);
	}

	render(width: number): string[] {
		const safeWidth = Math.max(50, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const lines = [
			renderTopBorder(safeWidth, " Message agent ", this.theme),
			renderBoxedLine(this.theme.fg("muted", `Send a follow-up to ${this.agentName}. The worker will answer in TRACKING.`), safeWidth, this.theme),
			renderDivider(safeWidth, this.theme),
			...this.editor.render(Math.max(1, innerWidth - 2)).map((line) => renderBoxedLine(` ${line}`, safeWidth, this.theme)),
			renderDivider(safeWidth, this.theme),
			renderBoxedLine(`${this.theme.fg("accent", "Enter")} send  ${this.theme.fg("accent", "Shift+Enter")} newline  ${this.theme.fg("accent", "Esc/Ctrl+C")} cancel`, safeWidth, this.theme),
			renderBottomBorder(safeWidth, this.theme),
		];
		return lines.map((line) => clampLine(line, safeWidth));
	}

	invalidate(): void {
		this.editor.invalidate();
	}
}
