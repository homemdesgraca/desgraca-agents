import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";
import { setupCompiledProject } from "./helpers/test-utils.mjs";

const { importCompiled } = setupCompiledProject();

const theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};

function makeJob(base, overrides = {}) {
	return {
		id: base.id,
		name: base.name,
		task: base.task ?? `${base.name} task`,
		status: "draft",
		allowedTools: [],
		readableRoot: "/tmp/project",
		writableRoot: `/tmp/project/.agents/${base.name}`,
		logs: [],
		tracking: [],
		pendingApprovals: [],
		artifacts: [],
		createdAt: base.createdAt,
		updatedAt: base.createdAt,
		...overrides,
	};
}

function source(sessionId, draftId, order) {
	return { kind: "orchestrator", sessionId, draftId, order };
}

describe("parallel agent groups", () => {
	test("groups orchestrator jobs by session and order without grouping manual jobs or other sessions", async () => {
		const { buildAgentListView, findParallelGroupForJob } = await importCompiled("src/agents/agent-groups.js");
		const manual = makeJob({ id: "m", name: "manual", createdAt: 1 });
		const a = makeJob({ id: "a", name: "alpha", createdAt: 2 }, { source: source("s1", "d1", 2) });
		const b = makeJob({ id: "b", name: "beta", createdAt: 3 }, { source: source("s1", "d2", 2) });
		const c = makeJob({ id: "c", name: "gamma", createdAt: 4 }, { source: source("s2", "d3", 2) });
		const d = makeJob({ id: "d", name: "delta", createdAt: 5 }, { source: source("s1", "d4", 3) });

		const view = buildAgentListView([d, c, b, a, manual]);
		assert.deepEqual(view.selectableJobs.map((job) => job.id), ["m", "a", "b", "d", "c"]);
		assert.equal(view.groups.length, 3);
		assert.deepEqual(view.groups.map((group) => [group.key.sessionId, group.key.order, group.jobs.map((job) => job.id)]), [
			["s1", 2, ["a", "b"]],
			["s1", 3, ["d"]],
			["s2", 2, ["c"]],
		]);
		assert.equal(findParallelGroupForJob([manual, a, b, c, d], manual), undefined);
		assert.equal(findParallelGroupForJob([manual, a, b, c, d], d), undefined);
		assert.deepEqual(findParallelGroupForJob([manual, a, b, c, d], a)?.jobs.map((job) => job.id), ["a", "b"]);
	});

	test("classifies runnable and skipped group members and warns at size four", async () => {
		const { buildGroupStartPlan, getAgentNotRunnableReason } = await importCompiled("src/agents/agent-groups.js");
		const runnable = makeJob({ id: "run", name: "run", createdAt: 1 }, { source: source("s1", "d1", 1) });
		const running = makeJob({ id: "running", name: "running", createdAt: 2 }, { source: source("s1", "d2", 1) });
		const done = makeJob({ id: "done", name: "done", createdAt: 3 }, { status: "done", source: source("s1", "d3", 1) });
		const artifact = makeJob({ id: "artifact", name: "artifact", createdAt: 4 }, { artifacts: [{ id: "x", agentId: "artifact", path: "p", absolutePath: "/tmp/p", sizeBytes: 1, updatedAt: 1 }], source: source("s1", "d4", 1) });
		const approval = makeJob({ id: "approval", name: "approval", createdAt: 5 }, { pendingApprovals: [{ id: "p", agentId: "approval", agentName: "approval", toolName: "bash", inputSummary: "cmd", warnings: [], reason: "ask", status: "pending", createdAt: 1 }], source: source("s1", "d5", 1) });
		const started = makeJob({ id: "started", name: "started", createdAt: 6 }, { startedAt: 1, source: source("s1", "d6", 1) });
		const prior = makeJob({ id: "prior", name: "prior", createdAt: 7 }, { finalResponse: "done before", source: source("s1", "d7", 1) });
		const group = { key: { sessionId: "s1", order: 1 }, label: "Parallel group", isParallel: true, jobs: [runnable, running, done, artifact] };

		const plan = buildGroupStartPlan(group, (jobId) => jobId === "running");
		assert.equal(plan.largeWarning, true);
		assert.deepEqual(plan.runnable.map((job) => job.id), ["run"]);
		assert.deepEqual(plan.skipped.map((member) => [member.job.id, member.reason]), [
			["running", "already running"],
			["done", "status is done"],
			["artifact", "has artifacts"],
		]);
		assert.equal(getAgentNotRunnableReason(approval), "has pending approvals");
		assert.equal(getAgentNotRunnableReason(started), "already started");
		assert.equal(getAgentNotRunnableReason(prior), "has prior output");
	});

	test("renders grouped agent list, keybinding, footer, and help text", async () => {
		const { buildAgentListView } = await importCompiled("src/agents/agent-groups.js");
		const { parseDashboardAction } = await importCompiled("src/dashboard/keybindings.js");
		const { renderAgentListView, renderFooterHints, renderHelp } = await importCompiled("src/dashboard/render.js");
		const manual = makeJob({ id: "m", name: "manual", createdAt: 1 });
		const a = makeJob({ id: "a", name: "alpha", createdAt: 2 }, { source: source("session-one", "d1", 2) });
		const b = makeJob({ id: "b", name: "beta", createdAt: 3 }, { source: source("session-one", "d2", 2), pendingApprovals: [{ id: "p", agentId: "b", agentName: "beta", toolName: "bash", inputSummary: "cmd", warnings: [], reason: "ask", status: "pending", createdAt: 1 }] });

		assert.deepEqual(parseDashboardAction("U"), { type: "groupStart" });
		assert.deepEqual(parseDashboardAction("u"), { type: "groupStart" });
		assert.match(renderFooterHints(120, theme, "normal").join("\n"), /U.*group start/);
		assert.match(renderHelp(120, theme).join("\n"), /starts the\s+selected orchestrator order group/);

		const rendered = renderAgentListView(buildAgentListView([b, a, manual]), "b", 120, theme).join("\n");
		assert.match(rendered, /Manual workers/);
		assert.match(rendered, /Parallel group: session session-/);
		assert.match(rendered, /1\. manual/);
		assert.match(rendered, /2\. alpha/);
		assert.match(rendered, /3\. beta/);
		assert.match(rendered, /approvals:1/);
		assert.match(rendered, /ord:2/);
	});

	test("dashboard numeric selection follows grouped display order", async () => {
		const { Dashboard } = await importCompiled("src/dashboard/Dashboard.js");
		const manual = makeJob({ id: "m", name: "manual", createdAt: 1 });
		const a = makeJob({ id: "a", name: "alpha", createdAt: 2 }, { source: source("s1", "d1", 2) });
		const b = makeJob({ id: "b", name: "beta", createdAt: 3 }, { source: source("s1", "d2", 2) });
		const jobs = [b, a, manual];
		let selectedId;
		const store = {
			subscribe: () => () => undefined,
			list: () => jobs,
			getSelected: () => jobs.find((job) => job.id === selectedId) ?? jobs[0],
			getSelectedId: () => selectedId,
			select: (id) => {
				selectedId = id;
				return jobs.find((job) => job.id === id);
			},
		};
		const runner = { start: async () => undefined, send: async () => undefined, abort: () => undefined, isRunning: () => false };
		const dashboard = new Dashboard(store, runner, { createJob: async () => undefined, close: () => undefined, notify: () => undefined, deleteJob: async () => false, clearJob: async () => false, sendMessage: async () => undefined, openArtifactViewer: async () => undefined }, { requestRender: () => undefined }, theme);
		try {
			dashboard.handleInput("2");
			assert.equal(selectedId, "a");
			dashboard.handleInput("3");
			assert.equal(selectedId, "b");
		} finally {
			dashboard.dispose();
		}
	});

	test("start group dialog renders runnable, skipped, warning, and handles input", async () => {
		const { buildGroupStartPlan } = await importCompiled("src/agents/agent-groups.js");
		const { StartAgentGroupDialog } = await importCompiled("src/dashboard/start-agent-group-dialog.js");
		const jobs = [
			makeJob({ id: "a", name: "alpha", createdAt: 1 }, { source: source("session-long-id", "d1", 1) }),
			makeJob({ id: "b", name: "beta", createdAt: 2 }, { source: source("session-long-id", "d2", 1) }),
			makeJob({ id: "c", name: "gamma", createdAt: 3 }, { status: "done", source: source("session-long-id", "d3", 1) }),
			makeJob({ id: "d", name: "delta", createdAt: 4 }, { source: source("session-long-id", "d4", 1) }),
		];
		const plan = buildGroupStartPlan({ key: { sessionId: "session-long-id", order: 1 }, label: "Parallel group", isParallel: true, jobs });
		const results = [];
		const dialog = new StartAgentGroupDialog(plan, theme, (confirmed) => results.push(confirmed));
		const rendered = dialog.render(100).join("\n");
		assert.match(rendered, /Session session-long/);
		assert.match(rendered, /Large group warning/);
		assert.match(rendered, /alpha/);
		assert.match(rendered, /gamma: status is done/);
		dialog.handleInput("n");
		assert.deepEqual(results, [false]);
		dialog.handleInput("\r");
		assert.deepEqual(results, [false, true]);
	});

	test("orchestrator store creates order start requests and records individual final responses", async () => {
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { OrchestratorStore } = await importCompiled("src/orchestrator/orchestrator-store.js");
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "order-start-request-"));
		try {
			const agentStore = new AgentStore();
			await agentStore.loadFromDisk(cwd);
			const store = new OrchestratorStore(agentStore);
			await store.loadFromDisk(cwd);
			const session = await store.create(cwd, { title: "Order starts" });
			const first = await store.createOrUpdateDraft(session.id, { name: "First", task: "first task", order: 4 }, createDefaultSettings());
			const second = await store.createOrUpdateDraft(session.id, { name: "Second", task: "second task", order: 4 }, createDefaultSettings());
			const single = await store.createOrUpdateDraft(session.id, { name: "Solo", task: "solo task", order: 5 }, createDefaultSettings());

			const groupRequest = await store.createStartRequest(session.id, { order: 4, waitForResponse: true });
			assert.equal(groupRequest.kind, "order");
			assert.equal(groupRequest.order, 4);
			assert.deepEqual(groupRequest.agentNames, ["first", "second"]);
			assert.deepEqual(groupRequest.agentJobIds, [first.job.id, second.job.id]);
			const singleRequest = await store.createStartRequest(session.id, { order: 5, waitForResponse: false });
			assert.equal(singleRequest.kind, "order");
			assert.deepEqual(singleRequest.agentNames, ["solo"]);
			assert.deepEqual(singleRequest.agentJobIds, [single.job.id]);

			await store.resolveStartRequest(session.id, groupRequest.id, { status: "approved" });
			await store.markStartRequestStarted(session.id, groupRequest.id, [first.job.id, second.job.id]);
			agentStore.update(first.job.id, { status: "done", finalResponse: "First final response." });
			agentStore.update(second.job.id, { status: "done", finalResponse: "Second final response." });
			await store.refreshStartRequestsFromJobs();
			const refreshed = (await store.listStartRequests(session.id)).find((request) => request.id === groupRequest.id);
			assert.equal(refreshed?.status, "done");
			assert.match(refreshed?.resultSummary ?? "", /first:\nFirst final response/);
			assert.match(refreshed?.resultSummary ?? "", /second:\nSecond final response/);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("orchestrator rendering makes pending start requests obvious", async () => {
		const { renderOrchestratorLeft, renderOrchestratorRight } = await importCompiled("src/dashboard/render-orchestrator.js");
		const snapshot = {
			session: { id: "s1", title: "Session", cwd: "/tmp/project", status: "waiting_for_user", activePlanPath: "/tmp/plan.md", createdAt: 1, updatedAt: 2 },
			plan: "# Plan",
			drafts: [],
			startRequests: [{ id: "r1", sessionId: "s1", kind: "order", order: 2, agentName: "order 2 group", agentNames: ["a", "b"], waitForResponse: false, status: "pending", message: "Start order 2.", createdAt: 3 }],
			transcript: [],
		};
		assert.match(renderOrchestratorRight(snapshot, 120, theme).join("\n"), /ACTION REQUIRED/);
		assert.match(renderOrchestratorRight(snapshot, 120, theme).join("\n"), /S\/Enter to review and approve/);
		assert.match(renderOrchestratorLeft([snapshot.session], "s1", snapshot, [], 90, theme).join("\n"), /Action required: 1 pending start request/);
	});

	test("orchestrator guidance mentions same-order parallel groups and order start requests", async () => {
		const { PiSubprocessOrchestratorRunner } = await importCompiled("src/orchestrator/orchestrator-runner.js");
		process.env.DESGRACA_ORCHESTRATOR_SESSION_ID = "session-1";
		process.env.DESGRACA_ORCHESTRATOR_ROOT = "/tmp/project/.agents/_orchestrator";
		process.env.DESGRACA_ORCHESTRATOR_CWD = "/tmp/project";
		const extension = (await importCompiled("index.js")).default;
		const runner = new PiSubprocessOrchestratorRunner({ get: () => undefined }, () => ({}));
		const prompt = runner.buildPrompt({ id: "s", title: "Session", cwd: "/tmp/project", status: "idle", activePlanPath: "/tmp/plan.md", createdAt: 1, updatedAt: 1 }, "plan work");
		assert.match(prompt, /same numeric order.*parallelizable/);
		assert.match(prompt, /use orchestrator_request_start_agent with an order number/);

		const tools = new Map();
		extension({ on: () => undefined, registerCommand: () => undefined, registerTool: (spec) => tools.set(spec.name, spec), appendEntry: () => undefined });
		const createDraft = tools.get("orchestrator_create_agent_draft");
		assert.match(createDraft.promptGuidelines.join("\n"), /same order.*parallel/i);
		assert.deepEqual(Object.keys(createDraft.parameters.properties), ["name", "task", "order"]);
		const startTool = tools.get("orchestrator_request_start_agent");
		assert.match(startTool.promptGuidelines.join("\n"), /Prefer order/);
		assert.ok("order" in startTool.parameters.properties);
		assert.ok("name" in startTool.parameters.properties);
	});

	test("orchestrator start request overlay renders approve and deny requests", async () => {
		const { buildGroupStartPlan } = await importCompiled("src/agents/agent-groups.js");
		const { OrchestratorStartRequestDialog } = await importCompiled("src/dashboard/orchestrator-start-request-dialog.js");
		const jobs = [
			makeJob({ id: "a", name: "alpha", createdAt: 1 }, { source: source("s1", "d1", 2) }),
			makeJob({ id: "b", name: "beta", createdAt: 2 }, { status: "done", source: source("s1", "d2", 2) }),
		];
		const plan = buildGroupStartPlan({ key: { sessionId: "s1", order: 2 }, label: "order 2", isParallel: true, jobs });
		const request = { id: "r1", sessionId: "s1", kind: "order", order: 2, agentName: "order 2 group", agentNames: ["alpha", "beta"], waitForResponse: true, status: "pending", message: "Start order 2.", createdAt: 1 };
		const approveResults = [];
		const approve = new OrchestratorStartRequestDialog({ request, mode: "approve", plan, theme, done: (confirmed) => approveResults.push(confirmed) });
		const rendered = approve.render(110).join("\n");
		assert.match(rendered, /Action required/);
		assert.match(rendered, /Runnable agents/);
		assert.match(rendered, /alpha/);
		assert.match(rendered, /beta: status is done/);
		approve.handleInput("y");
		assert.deepEqual(approveResults, [true]);

		const denyResults = [];
		const deny = new OrchestratorStartRequestDialog({ request, mode: "deny", theme, done: (confirmed) => denyResults.push(confirmed) });
		assert.match(deny.render(90).join("\n"), /Deny orchestrator start request/);
		deny.handleInput("q");
		assert.deepEqual(denyResults, [false]);
	});
});
