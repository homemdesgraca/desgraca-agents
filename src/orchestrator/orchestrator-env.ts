import type { AgentModelSelection } from "../agents/agent-job.ts";
import type { AgentExtensionSettings } from "../settings/settings.ts";

export const ORCHESTRATOR_SESSION_ID_ENV = "DESGRACA_ORCHESTRATOR_SESSION_ID";
export const ORCHESTRATOR_ROOT_ENV = "DESGRACA_ORCHESTRATOR_ROOT";
export const ORCHESTRATOR_CWD_ENV = "DESGRACA_ORCHESTRATOR_CWD";
export const ORCHESTRATOR_SETTINGS_ENV = "DESGRACA_ORCHESTRATOR_SETTINGS";
export const ORCHESTRATOR_MODEL_ENV = "DESGRACA_ORCHESTRATOR_MODEL";

export interface OrchestratorProcessEnvContext {
	sessionId: string;
	root: string;
	cwd: string;
	settings?: AgentExtensionSettings;
	model?: AgentModelSelection;
}

function parseJsonEnv<T>(value: string | undefined): T | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as T;
	} catch {
		return undefined;
	}
}

export function getOrchestratorProcessEnvContext(env: NodeJS.ProcessEnv = process.env): OrchestratorProcessEnvContext | undefined {
	const sessionId = env[ORCHESTRATOR_SESSION_ID_ENV];
	const root = env[ORCHESTRATOR_ROOT_ENV];
	const cwd = env[ORCHESTRATOR_CWD_ENV];
	if (!sessionId || !root || !cwd) return undefined;
	return {
		sessionId,
		root,
		cwd,
		settings: parseJsonEnv<AgentExtensionSettings>(env[ORCHESTRATOR_SETTINGS_ENV]),
		model: parseJsonEnv<AgentModelSelection>(env[ORCHESTRATOR_MODEL_ENV]),
	};
}
