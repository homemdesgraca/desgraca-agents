import { matchesKey } from "@earendil-works/pi-tui";

export type DashboardAction =
	| { type: "close" }
	| { type: "create" }
	| { type: "clear" }
	| { type: "select"; index: number }
	| { type: "start" }
	| { type: "abort" }
	| { type: "approve" }
	| { type: "deny" }
	| { type: "logs" }
	| { type: "orchestrator" }
	| { type: "approvals" }
	| { type: "artifacts" }
	| { type: "help" }
	| { type: "normal" }
	| { type: "previousMode" }
	| { type: "nextMode" }
	| { type: "refresh" }
	| { type: "delete" }
	| { type: "edit" }
	| { type: "message" }
	| { type: "artifactPrevious" }
	| { type: "artifactNext" }
	| { type: "artifactOpen" }
	| { type: "toggleNotes" }
	| { type: "toggleAutoScroll" }
	| { type: "scrollUp" }
	| { type: "scrollDown" }
	| { type: "scrollTop" }
	| { type: "scrollBottom" };

export const DASHBOARD_HELP_TEXT = "Mode keys: G/O/T/P/F/H direct, Q/E walk modes. PgUp/PgDn top/bottom. L toggles auto-scroll. Esc closes.";

export function parseDashboardAction(input: string): DashboardAction | undefined {
	if (matchesKey(input, "escape") || matchesKey(input, "ctrl+c")) return { type: "close" };
	if (input === "q" || input === "Q") return { type: "previousMode" };
	if (input === "e" || input === "E") return { type: "nextMode" };
	if (input === "c" || input === "C") return { type: "create" };
	if (input === "k" || input === "K") return { type: "clear" };
	if (input >= "1" && input <= "9") return { type: "select", index: Number(input) - 1 };
	if (input === "s" || input === "S") return { type: "start" };
	if (input === "x" || input === "X") return { type: "abort" };
	if (input === "m" || input === "M") return { type: "message" };
	if (input === "i" || input === "I") return { type: "edit" };
	if (input === "a" || input === "A") return { type: "approve" };
	if (input === "n" || input === "N") return { type: "deny" };
	if (input === "g" || input === "G") return { type: "normal" };
	if (input === "o" || input === "O") return { type: "orchestrator" };
	if (input === "t" || input === "T") return { type: "logs" };
	if (input === "p" || input === "P") return { type: "approvals" };
	if (input === "f" || input === "F") return { type: "artifacts" };
	if (input === "h" || input === "H" || input === "?") return { type: "help" };
	if (input === "[") return { type: "artifactPrevious" };
	if (input === "]") return { type: "artifactNext" };
	if (matchesKey(input, "enter")) return { type: "artifactOpen" };
	if (input === "v" || input === "V") return { type: "toggleNotes" };
	if (matchesKey(input, "delete") || matchesKey(input, "backspace")) return { type: "delete" };
	if (matchesKey(input, "up")) return { type: "scrollUp" };
	if (matchesKey(input, "down")) return { type: "scrollDown" };
	if (matchesKey(input, "pageUp")) return { type: "scrollTop" };
	if (matchesKey(input, "pageDown")) return { type: "scrollBottom" };
	if (input === "l" || input === "L") return { type: "toggleAutoScroll" };
	if (input === "r" || input === "R") return { type: "refresh" };
	return undefined;
}
