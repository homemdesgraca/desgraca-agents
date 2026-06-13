export const AGENT_JOB_ID_ENV = "DESGRACA_AGENT_JOB_ID";
export const AGENT_NAME_ENV = "DESGRACA_AGENT_NAME";
export const AGENT_WRITABLE_ROOT_ENV = "DESGRACA_AGENT_WRITABLE_ROOT";

export interface AgentProcessEnvContext {
	id: string;
	name: string;
	writableRoot?: string;
}

export function getAgentProcessEnvContext(env: NodeJS.ProcessEnv = process.env): AgentProcessEnvContext | undefined {
	const id = env[AGENT_JOB_ID_ENV];
	const name = env[AGENT_NAME_ENV];
	if (!id || !name) return undefined;
	return {
		id,
		name,
		writableRoot: env[AGENT_WRITABLE_ROOT_ENV],
	};
}
