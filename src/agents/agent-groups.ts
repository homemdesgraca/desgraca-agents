import type { AgentJob } from "./agent-job.ts";

export const LARGE_AGENT_GROUP_WARNING_THRESHOLD = 4;

export interface AgentParallelGroupKey {
	sessionId: string;
	order: number;
}

export interface AgentParallelGroup {
	key: AgentParallelGroupKey;
	jobs: AgentJob[];
	label: string;
	isParallel: boolean;
}

export type AgentListItem =
	| { kind: "section"; title: string }
	| { kind: "group"; key: AgentParallelGroupKey; title: string; count: number; isParallel: boolean }
	| { kind: "job"; job: AgentJob; selectableIndex: number; groupKey?: AgentParallelGroupKey };

export interface AgentListView {
	items: AgentListItem[];
	selectableJobs: AgentJob[];
	groups: AgentParallelGroup[];
}

export interface GroupStartMember {
	job: AgentJob;
	runnable: boolean;
	reason?: string;
}

export interface GroupStartPlan {
	group: AgentParallelGroup;
	members: GroupStartMember[];
	runnable: AgentJob[];
	skipped: GroupStartMember[];
	largeWarning: boolean;
}

export type IsAgentRunning = (jobId: string) => boolean;

function groupKeyString(key: AgentParallelGroupKey): string {
	return `${key.sessionId}\u0000${key.order}`;
}

function shortSessionId(sessionId: string): string {
	return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function compareJobs(a: AgentJob, b: AgentJob): number {
	return a.createdAt - b.createdAt || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function makeGroupLabel(key: AgentParallelGroupKey, count: number): string {
	const session = shortSessionId(key.sessionId);
	if (count > 1) return `Parallel group: session ${session} order ${key.order} (${count} agents)`;
	return `Orchestrator ${session} order ${key.order}`;
}

export function buildAgentListView(jobs: AgentJob[]): AgentListView {
	const manualJobs = jobs.filter((job) => job.source?.kind !== "orchestrator").sort(compareJobs);
	const grouped = new Map<string, AgentJob[]>();
	const sessionFirstCreated = new Map<string, number>();
	for (const job of jobs) {
		if (job.source?.kind !== "orchestrator") continue;
		const key = groupKeyString({ sessionId: job.source.sessionId, order: job.source.order });
		grouped.set(key, [...(grouped.get(key) ?? []), job]);
		sessionFirstCreated.set(job.source.sessionId, Math.min(sessionFirstCreated.get(job.source.sessionId) ?? job.createdAt, job.createdAt));
	}

	const groups: AgentParallelGroup[] = [...grouped.values()].map((groupJobs) => {
		const sortedJobs = [...groupJobs].sort(compareJobs);
		const source = sortedJobs[0]?.source;
		const key = { sessionId: source?.sessionId ?? "unknown", order: source?.order ?? 0 };
		return {
			key,
			jobs: sortedJobs,
			label: makeGroupLabel(key, sortedJobs.length),
			isParallel: sortedJobs.length > 1,
		};
	}).sort((a, b) => {
		return (sessionFirstCreated.get(a.key.sessionId) ?? 0) - (sessionFirstCreated.get(b.key.sessionId) ?? 0)
			|| a.key.sessionId.localeCompare(b.key.sessionId)
			|| a.key.order - b.key.order
			|| (a.jobs[0]?.createdAt ?? 0) - (b.jobs[0]?.createdAt ?? 0);
	});

	const items: AgentListItem[] = [];
	const selectableJobs: AgentJob[] = [];
	const pushJob = (job: AgentJob, groupKey?: AgentParallelGroupKey) => {
		selectableJobs.push(job);
		items.push({ kind: "job", job, selectableIndex: selectableJobs.length, groupKey });
	};

	if (manualJobs.length > 0) {
		items.push({ kind: "section", title: "Manual workers" });
		for (const job of manualJobs) pushJob(job);
	}

	if (groups.length > 0) {
		if (manualJobs.length > 0) items.push({ kind: "section", title: "Orchestrator workers" });
		for (const group of groups) {
			items.push({ kind: "group", key: group.key, title: group.label, count: group.jobs.length, isParallel: group.isParallel });
			for (const job of group.jobs) pushJob(job, group.key);
		}
	}

	return { items, selectableJobs, groups };
}

export function sameGroupKey(a: AgentParallelGroupKey | undefined, b: AgentParallelGroupKey | undefined): boolean {
	return !!a && !!b && a.sessionId === b.sessionId && a.order === b.order;
}

export function findGroupForJob(jobs: AgentJob[], selected: AgentJob | undefined): AgentParallelGroup | undefined {
	if (selected?.source?.kind !== "orchestrator") return undefined;
	const view = buildAgentListView(jobs);
	return view.groups.find((group) => group.key.sessionId === selected.source?.sessionId && group.key.order === selected.source?.order);
}

export function findParallelGroupForJob(jobs: AgentJob[], selected: AgentJob | undefined): AgentParallelGroup | undefined {
	const group = findGroupForJob(jobs, selected);
	return group?.isParallel ? group : undefined;
}

export function getAgentNotRunnableReason(job: AgentJob, isRunning: IsAgentRunning = () => false): string | undefined {
	if (isRunning(job.id)) return "already running";
	if (job.status !== "draft") return `status is ${job.status}`;
	if (job.pendingApprovals.some((approval) => approval.status === "pending")) return "has pending approvals";
	if (job.artifacts.length > 0) return "has artifacts";
	if (job.startedAt) return "already started";
	if (job.finalResponse || job.process) return "has prior output";
	if (job.pendingApprovals.length > 0) return "has prior approvals";
	return undefined;
}

export function isAgentRunnable(job: AgentJob, isRunning: IsAgentRunning = () => false): boolean {
	return !getAgentNotRunnableReason(job, isRunning);
}

export function buildGroupStartPlan(group: AgentParallelGroup, isRunning: IsAgentRunning = () => false): GroupStartPlan {
	const members = group.jobs.map((job) => {
		const reason = getAgentNotRunnableReason(job, isRunning);
		return reason ? { job, runnable: false, reason } : { job, runnable: true };
	});
	return {
		group,
		members,
		runnable: members.filter((member) => member.runnable).map((member) => member.job),
		skipped: members.filter((member) => !member.runnable),
		largeWarning: group.jobs.length >= LARGE_AGENT_GROUP_WARNING_THRESHOLD,
	};
}
