const BASH_PATTERNS: Array<[RegExp, string]> = [
	[/\brm\b/, "Warning: rm detected"],
	[/\bcurl\b/, "Warning: curl detected"],
	[/\bwget\b/, "Warning: wget detected"],
	[/\bsudo\b/, "Warning: sudo detected"],
	[/\bchmod\b/, "Warning: chmod detected"],
	[/\bchown\b/, "Warning: chown detected"],
	[/\bkill(?:all)?\b/, "Warning: kill detected"],
	[/(^|[^<])>{1,2}[^>]|<\s*[^<]|\btee\b/, "Warning: shell redirection detected"],
];

export function getBashRiskWarnings(command: string): string[] {
	const warnings: string[] = [];
	for (const [pattern, warning] of BASH_PATTERNS) {
		if (pattern.test(command) && !warnings.includes(warning)) warnings.push(warning);
	}
	return warnings;
}

export function getRiskWarnings(toolName: string, input: unknown): string[] {
	if (toolName !== "bash") return [];
	const command = typeof input === "object" && input && "command" in input ? String((input as { command?: unknown }).command ?? "") : "";
	return getBashRiskWarnings(command);
}
