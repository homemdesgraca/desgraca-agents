import { matchesKey } from "@earendil-works/pi-tui";

export type DashboardAction =
	| { type: "close" }
	| { type: "create" }
	| { type: "select"; index: number }
	| { type: "start" }
	| { type: "abort" }
	| { type: "approve" }
	| { type: "deny" }
	| { type: "logs" }
	| { type: "approvals" }
	| { type: "artifacts" }
	| { type: "help" }
	| { type: "normal" }
	| { type: "refresh" }
	| { type: "delete" }
	| { type: "message" }
	| { type: "scrollUp" }
	| { type: "scrollDown" };

export const DASHBOARD_HELP_TEXT = "H opens full help. ↑/↓ scroll right panel. Enter returns to agents mode.";

export function parseDashboardAction(input: string): DashboardAction | undefined {
	if (matchesKey(input, "escape") || input === "q" || input === "Q") return { type: "close" };
	if (input === "c" || input === "C") return { type: "create" };
	if (input >= "1" && input <= "9") return { type: "select", index: Number(input) - 1 };
	if (input === "s" || input === "S") return { type: "start" };
	if (input === "x" || input === "X") return { type: "abort" };
	if (input === "m" || input === "M") return { type: "message" };
	if (input === "a" || input === "A") return { type: "approve" };
	if (input === "n" || input === "N") return { type: "deny" };
	if (input === "l" || input === "L") return { type: "logs" };
	if (input === "p" || input === "P") return { type: "approvals" };
	if (input === "d" || input === "D") return { type: "artifacts" };
	if (input === "h" || input === "H" || input === "?") return { type: "help" };
	if (matchesKey(input, "enter")) return { type: "normal" };
	if (matchesKey(input, "delete") || matchesKey(input, "backspace")) return { type: "delete" };
	if (matchesKey(input, "up")) return { type: "scrollUp" };
	if (matchesKey(input, "down")) return { type: "scrollDown" };
	if (input === "r" || input === "R") return { type: "refresh" };
	return undefined;
}
