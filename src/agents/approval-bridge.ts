import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentApproval } from "./agent-job.ts";
import { createId } from "./agent-job.ts";

export const AGENT_APPROVAL_BRIDGE_DIR = ".agent-approvals";

export function getApprovalBridgeDir(writableRoot: string): string {
	return path.resolve(writableRoot, AGENT_APPROVAL_BRIDGE_DIR);
}

export function getApprovalBridgeFile(writableRoot: string, approvalId: string): string {
	return path.join(getApprovalBridgeDir(writableRoot), `${approvalId}.json`);
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${createId()}.tmp`;
	await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	await fs.rename(tmpPath, filePath);
}

function isApprovalRecord(value: unknown): value is AgentApproval {
	if (!value || typeof value !== "object") return false;
	const data = value as Partial<AgentApproval>;
	return typeof data.id === "string"
		&& typeof data.agentId === "string"
		&& typeof data.agentName === "string"
		&& typeof data.toolName === "string"
		&& typeof data.inputSummary === "string"
		&& Array.isArray(data.warnings)
		&& typeof data.reason === "string"
		&& (data.status === "pending" || data.status === "approved" || data.status === "denied");
}

export async function readApprovalBridgeRecord(writableRoot: string, approvalId: string): Promise<AgentApproval | undefined> {
	try {
		const data = JSON.parse(await fs.readFile(getApprovalBridgeFile(writableRoot, approvalId), "utf8")) as unknown;
		return isApprovalRecord(data) ? data : undefined;
	} catch {
		return undefined;
	}
}

export async function writeApprovalBridgeRecord(writableRoot: string, approval: AgentApproval): Promise<void> {
	await writeJsonAtomic(getApprovalBridgeFile(writableRoot, approval.id), approval);
}

export async function resolveApprovalBridgeRecord(writableRoot: string, approval: AgentApproval): Promise<void> {
	await writeApprovalBridgeRecord(writableRoot, {
		...approval,
		resolvedAt: approval.resolvedAt ?? Date.now(),
	});
}

export async function listApprovalBridgeRecords(writableRoot: string): Promise<AgentApproval[]> {
	const dir = getApprovalBridgeDir(writableRoot);
	let entries: Array<{ name: string; isFile(): boolean }>;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const approvals: AgentApproval[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		try {
			const data = JSON.parse(await fs.readFile(path.join(dir, entry.name), "utf8")) as unknown;
			if (isApprovalRecord(data)) approvals.push(data);
		} catch {}
	}
	return approvals.sort((a, b) => a.createdAt - b.createdAt);
}
