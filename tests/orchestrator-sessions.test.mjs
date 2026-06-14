import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";
import { setupCompiledProject } from "./helpers/test-utils.mjs";

const { importCompiled } = setupCompiledProject();

describe("orchestrator sessions", () => {
	test("dashboard keybinding reaches ORCHESTRATOR mode and footer avoids duplicate jump hints", async () => {
		const { parseDashboardAction } = await importCompiled("src/dashboard/keybindings.js");
		const { renderFooterHints } = await importCompiled("src/dashboard/render.js");
		const { renderOrchestratorRight } = await importCompiled("src/dashboard/render-orchestrator.js");
		assert.deepEqual(parseDashboardAction("O"), { type: "orchestrator" });
		assert.deepEqual(parseDashboardAction("o"), { type: "orchestrator" });
		const modes = ["normal", "orchestrator", "logs", "approvals", "artifacts", "help"];
		for (const mode of modes) {
			const footer = renderFooterHints(160, undefined, mode).join("\n");
			assert.doesNotMatch(footer, /jump/);
			assert.doesNotMatch(footer, /Q\/E/);
			assert.doesNotMatch(footer, /Esc/);
		}
		const orchestratorFooter = renderFooterHints(160, undefined, "orchestrator").join("\n");
		assert.match(orchestratorFooter, /C.*create/);
		assert.match(orchestratorFooter, /S.*start\/approve/);
		assert.match(orchestratorFooter, /I.*edit/);
		assert.match(orchestratorFooter, /X.*abort/);
		assert.match(orchestratorFooter, /K.*clear/);
		assert.match(orchestratorFooter, /Del.*delete/);

		const renderedOrchestrator = renderOrchestratorRight({
			session: { id: "s1", title: "Session", cwd: "/tmp/project", status: "running", activePlanPath: "/tmp/project/plan.md", createdAt: 1, updatedAt: 2 },
			plan: "# Plan\n- item one\n- item two\n- item three\n- item four\n- item five",
			drafts: [],
			startRequests: [],
			transcript: [
				{ id: "t1", timestamp: 3, kind: "user", title: "User message", message: "please coordinate" },
				{ id: "t2", timestamp: 4, kind: "tool", title: "Tool: orchestrator_list_agent_statuses", input: "{}", output: "No worker drafts yet." },
				{ id: "t3", timestamp: 5, kind: "assistant", title: "Assistant response", message: "I will track this like the worker tracking screen." },
			],
		}, 100).join("\n");
		assert.match(renderedOrchestrator, /Transcript/);
		assert.match(renderedOrchestrator, /User message/);
		assert.match(renderedOrchestrator, /Input:/);
		assert.match(renderedOrchestrator, /Output:/);
		assert.match(renderedOrchestrator, /Assistant response/);
	});

	test("orchestrator clear and delete dialogs confirm or cancel explicitly", async () => {
		const { ClearOrchestratorSessionDialog } = await importCompiled("src/dashboard/clear-orchestrator-session-dialog.js");
		const { DeleteOrchestratorSessionDialog } = await importCompiled("src/dashboard/delete-orchestrator-session-dialog.js");
		const theme = {
			fg: (_color, text) => text,
			bg: (_color, text) => text,
			bold: (text) => text,
		};
		const session = {
			id: "session-1",
			title: "Planning session",
			cwd: "/tmp/project",
			status: "idle",
			activePlanPath: "/tmp/project/.agents/_orchestrator/sessions/session-1/plan.md",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		const clearResults = [];
		const clearDialog = new ClearOrchestratorSessionDialog(session, theme, (confirmed) => clearResults.push(confirmed));
		assert.match(clearDialog.render(90).join("\n"), /Clear Planning session/);
		clearDialog.handleInput("n");
		assert.deepEqual(clearResults, [false]);
		clearDialog.handleInput("y");
		assert.deepEqual(clearResults, [false, true]);

		const deleteResults = [];
		const deleteDialog = new DeleteOrchestratorSessionDialog(session, theme, (confirmed) => deleteResults.push(confirmed));
		assert.match(deleteDialog.render(90).join("\n"), /Delete Planning session/);
		assert.match(deleteDialog.render(90).join("\n"), /Linked worker jobs are not deleted/);
		deleteDialog.handleInput("q");
		assert.deepEqual(deleteResults, [false]);
		deleteDialog.handleInput("\r");
		assert.deepEqual(deleteResults, [false, true]);
	});

	test("orchestrator settings normalize safely and filter forbidden runner tools", async () => {
		const {
			createDefaultSettings,
			normalizeAgentExtensionSettings,
			sanitizeOrchestratorRunnerTools,
			knownOrchestratorPolicyTools,
			setOrchestratorToolPolicy,
		} = await importCompiled("src/settings/settings.js");
		const defaults = createDefaultSettings();
		assert.equal(defaults.agents.defaultModel, "default");
		assert.equal(defaults.orchestrator.toolPolicies.bash, "deny");
		assert.equal(defaults.orchestrator.toolPolicies.orchestrator_create_agent_draft, "allow");
		assert.equal(defaults.orchestrator.runnerTools.includes("write"), false);
		assert.equal(defaults.orchestrator.runnerTools.includes("edit"), false);
		assert.equal(defaults.orchestrator.runnerTools.includes("agent_write_proposal"), false);

		const normalized = normalizeAgentExtensionSettings({
			toolPolicies: { read: "deny", write: "allow" },
			childRunnerTools: ["read", "write", "agent_create_note"],
			orchestrator: {
				toolPolicies: { bash: "allow", write: "allow", orchestrator_update_plan: "deny" },
				runnerTools: ["bash", "write", "edit", "agent_write_proposal", "orchestrator_update_plan"],
			},
		});
		assert.equal(normalized.toolPolicies.read, "deny");
		assert.equal(normalized.toolPolicies.write, undefined);
		assert.equal(normalized.childRunnerTools.includes("write"), false);
		assert.equal(normalized.orchestrator.toolPolicies.write, undefined);
		assert.equal(normalized.orchestrator.toolPolicies.bash, "allow");
		assert.equal(normalized.orchestrator.runnerTools.includes("bash"), true);
		assert.equal(normalized.orchestrator.runnerTools.includes("write"), false);
		assert.equal(normalized.orchestrator.runnerTools.includes("agent_write_proposal"), false);

		const withDeniedBash = sanitizeOrchestratorRunnerTools(["read", "bash", "write", "orchestrator_update_plan"], { bash: "deny" });
		assert.deepEqual(withDeniedBash, ["read", "orchestrator_update_plan"]);
		const withWritePolicySet = setOrchestratorToolPolicy(defaults, "write", "allow");
		assert.equal(knownOrchestratorPolicyTools(withWritePolicySet).includes("write"), false);
	});

	test("agent store ignores reserved orchestrator directories while loading jobs", async () => {
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "reserved-orchestrator-"));
		try {
			const normal = createAgentJob(cwd, "normal worker", "normal task");
			await fsp.mkdir(normal.writableRoot, { recursive: true });
			await fsp.writeFile(path.join(normal.writableRoot, "agent-job.json"), JSON.stringify(normal, null, 2));
			const fake = createAgentJob(cwd, "fake orchestrator import", "must be ignored");
			await fsp.mkdir(path.join(cwd, ".agents", "_orchestrator"), { recursive: true });
			await fsp.writeFile(path.join(cwd, ".agents", "_orchestrator", "agent-job.json"), JSON.stringify(fake, null, 2));

			const store = new AgentStore();
			await store.loadFromDisk(cwd);
			assert.deepEqual(store.list().map((job) => job.name), ["normal-worker"]);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});


	test("orchestrator atomic persistence tolerates concurrent writes in the same millisecond", async () => {
		const { writeJsonFileAtomic, writeTextFileAtomic } = await importCompiled("src/orchestrator/persistence.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "atomic-persistence-"));
		const originalNow = Date.now;
		try {
			Date.now = () => 1234567890;
			const jsonFile = path.join(cwd, "session.json");
			await Promise.all(Array.from({ length: 20 }, (_, index) => writeJsonFileAtomic(jsonFile, { index })));
			const parsed = JSON.parse(await fsp.readFile(jsonFile, "utf8"));
			assert.equal(typeof parsed.index, "number");
			assert.equal(parsed.index >= 0 && parsed.index < 20, true);

			const textFile = path.join(cwd, "plan.md");
			await Promise.all(Array.from({ length: 20 }, (_, index) => writeTextFileAtomic(textFile, `plan ${index}`)));
			assert.match(await fsp.readFile(textFile, "utf8"), /^plan \d+$/);
			const leftovers = await fsp.readdir(cwd);
			assert.deepEqual(leftovers.filter((entry) => entry.endsWith(".tmp")), []);
		} finally {
			Date.now = originalNow;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("orchestrator store persists, clears, and deletes sessions", async () => {
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { OrchestratorStore } = await importCompiled("src/orchestrator/orchestrator-store.js");
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "orchestrator-store-"));
		try {
			const agentStore = new AgentStore();
			await agentStore.loadFromDisk(cwd);
			const store = new OrchestratorStore(agentStore);
			await store.loadFromDisk(cwd);
			const model = { provider: "test-provider", id: "planner", label: "Planner" };
			const session = await store.create(cwd, { title: " Build plan ", model, initialPlan: "initial plan" });
			assert.equal(store.getSelectedId(), session.id);
			assert.equal(session.title, "Build plan");
			assert.equal(await store.readPlan(session.id), "initial plan");

			await store.writePlan(session.id, "# Current plan\n\n- draft workers");
			await store.appendTranscript(session.id, { kind: "user", title: "User", message: "Plan the work" });
			await fsp.appendFile(path.join(cwd, ".agents", "_orchestrator", "sessions", session.id, "transcript.jsonl"), "not json\n", "utf8");
			const settings = createDefaultSettings();
			const draftResult = await store.createOrUpdateDraft(session.id, { name: "First Worker", task: "Implement first task", order: 1 }, settings);
			assert.equal(draftResult.draft.status, "queued");
			assert.equal(draftResult.job?.name, "first-worker");
			assert.deepEqual(draftResult.job?.model, model);
			assert.deepEqual(draftResult.job?.source, { kind: "orchestrator", sessionId: session.id, draftId: draftResult.draft.id, order: 1 });

			const request = await store.createStartRequest(session.id, { name: "First Worker", waitForResponse: false });
			assert.equal(request.status, "pending");
			assert.equal(store.get(session.id)?.status, "waiting_for_user");
			await store.resolveStartRequest(session.id, request.id, { status: "denied", denialReason: "not now" });
			assert.equal((await store.listStartRequests(session.id))[0].status, "denied");
			assert.equal((await store.listStartRequests(session.id))[0].denialReason, "not now");

			const reloadedAgentStore = new AgentStore();
			await reloadedAgentStore.loadFromDisk(cwd);
			const reloaded = new OrchestratorStore(reloadedAgentStore);
			await reloaded.loadFromDisk(cwd);
			const snapshot = await reloaded.getSnapshot(session.id);
			assert.equal(snapshot?.plan, "# Current plan\n\n- draft workers");
			assert.equal(snapshot?.drafts[0].name, "first-worker");
			assert.equal(snapshot?.startRequests[0].status, "denied");
			assert.ok(snapshot?.transcript.some((entry) => entry.title === "User"));
			assert.equal(snapshot?.transcript.some((entry) => entry.title === "not json"), false);

			await reloaded.clearSession(session.id);
			const cleared = await reloaded.getSnapshot(session.id);
			assert.equal(cleared?.plan, "");
			assert.deepEqual(cleared?.drafts, []);
			assert.deepEqual(cleared?.startRequests, []);
			assert.deepEqual(cleared?.transcript, []);
			assert.equal(reloaded.get(session.id)?.status, "idle");

			const sessionDir = reloaded.getSessionDir(session.id);
			assert.equal(await reloaded.deleteSession(session.id), true);
			assert.equal(reloaded.get(session.id), undefined);
			assert.equal(fs.existsSync(sessionDir), false);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("orchestrator draft sync resolves models and protects user edits", async () => {
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { OrchestratorStore } = await importCompiled("src/orchestrator/orchestrator-store.js");
		const { createDefaultSettings, setDefaultAgentModel } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "draft-sync-"));
		try {
			const agentStore = new AgentStore();
			await agentStore.loadFromDisk(cwd);
			const store = new OrchestratorStore(agentStore);
			await store.loadFromDisk(cwd);
			const sessionModel = { provider: "planner", id: "model-a", label: "planner/model-a" };
			const concreteModel = { provider: "worker", id: "model-b", label: "worker/model-b" };
			const userModel = { provider: "user", id: "override", label: "user/override" };
			const session = await store.create(cwd, { title: "Sync", model: sessionModel });

			const first = await store.createOrUpdateDraft(session.id, { name: "Editable", task: "original task", order: 1 }, createDefaultSettings());
			assert.deepEqual(first.job?.model, sessionModel);
			agentStore.updateUserEditable(first.job.id, { task: "manual task", model: userModel });
			const protectedUpdate = await store.createOrUpdateDraft(session.id, { name: "Editable", task: "orchestrator replacement", order: 2 }, setDefaultAgentModel(createDefaultSettings(), concreteModel));
			assert.match(protectedUpdate.warning ?? "", /edited by the user/);
			assert.equal(agentStore.get(first.job.id)?.task, "manual task");
			assert.deepEqual(agentStore.get(first.job.id)?.model, userModel);
			assert.equal(agentStore.get(first.job.id)?.source?.order, 2);
			assert.equal((await store.listDrafts(session.id)).find((draft) => draft.id === first.draft.id)?.task, "orchestrator replacement");

			const second = await store.createOrUpdateDraft(session.id, { name: "Concrete", task: "concrete model task", order: 3 }, setDefaultAgentModel(createDefaultSettings(), concreteModel));
			assert.deepEqual(second.job?.model, concreteModel);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("orchestrator store updates start requests from terminal worker statuses", async () => {
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { OrchestratorStore } = await importCompiled("src/orchestrator/orchestrator-store.js");
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "request-refresh-"));
		try {
			const agentStore = new AgentStore();
			await agentStore.loadFromDisk(cwd);
			const store = new OrchestratorStore(agentStore);
			await store.loadFromDisk(cwd);
			const session = await store.create(cwd, { title: "Requests" });
			const draft = await store.createOrUpdateDraft(session.id, { name: "Runner", task: "finish", order: 1 }, createDefaultSettings());
			const request = await store.createStartRequest(session.id, { name: "Runner", waitForResponse: true });
			await store.resolveStartRequest(session.id, request.id, { status: "approved" });
			await store.markStartRequestStarted(session.id, request.id, draft.job.id);
			agentStore.update(draft.job.id, { status: "done", finalResponse: "Finished successfully with a useful summary." });
			await store.refreshStartRequestsFromJobs();
			const refreshed = (await store.listStartRequests(session.id)).find((item) => item.id === request.id);
			assert.equal(refreshed?.status, "done");
			assert.match(refreshed?.resultSummary ?? "", /Finished successfully/);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("orchestrator tools validate drafts, persist notes, and create no-wait start requests", async () => {
		const extension = (await importCompiled("index.js")).default;
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { OrchestratorStore } = await importCompiled("src/orchestrator/orchestrator-store.js");
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "orchestrator-tools-"));
		try {
			const settings = createDefaultSettings();
			const agentStore = new AgentStore();
			await agentStore.loadFromDisk(cwd);
			const store = new OrchestratorStore(agentStore);
			await store.loadFromDisk(cwd);
			const session = await store.create(cwd, { title: "Tool Session" });
			process.env.DESGRACA_ORCHESTRATOR_SESSION_ID = session.id;
			process.env.DESGRACA_ORCHESTRATOR_ROOT = store.getOrchestratorRoot(cwd);
			process.env.DESGRACA_ORCHESTRATOR_CWD = cwd;
			process.env.DESGRACA_ORCHESTRATOR_SETTINGS = JSON.stringify(settings);

			const tools = new Map();
			extension({
				on: () => {},
				registerCommand: () => {},
				registerTool: (spec) => tools.set(spec.name, spec),
				appendEntry: () => {},
			});
			assert.ok(tools.has("orchestrator_update_plan"));
			assert.ok(tools.has("orchestrator_create_agent_draft"));
			assert.equal(tools.has("agent_write_proposal"), false);
			assert.equal(tools.has("write"), false);

			await tools.get("orchestrator_update_plan").execute("plan", { content: "# Tool plan" });
			await assert.rejects(
				() => tools.get("orchestrator_create_agent_draft").execute("bad-draft", { name: "Bad", task: "missing order", order: 0 }),
				/positive number/,
			);
			const draftResult = await tools.get("orchestrator_create_agent_draft").execute("draft", { name: "Tool Worker", task: "Use the tool path", order: 1 });
			assert.match(draftResult.content[0].text, /tool-worker/);
			const statusResult = await tools.get("orchestrator_list_agent_statuses").execute("statuses", {});
			assert.match(statusResult.content[0].text, /tool-worker/);
			const detailsResult = await tools.get("orchestrator_get_agent_details").execute("details", { name: "Tool Worker" });
			assert.match(detailsResult.content[0].text, /Agent status: draft/);
			const requestResult = await tools.get("orchestrator_request_start_agent").execute("start", { name: "Tool Worker", waitForResponse: false });
			assert.match(requestResult.content[0].text, /Start request created/);

			await tools.get("orchestrator_create_note").execute("note", { name: "handoff", content: "alpha beta" });
			const noteList = await tools.get("orchestrator_view_notes").execute("notes-list", {});
			assert.match(noteList.content[0].text, /handoff\.md/);
			await tools.get("orchestrator_edit_note").execute("note-edit", { name: "handoff", edits: [{ oldText: "beta", newText: "gamma" }] });
			const noteRead = await tools.get("orchestrator_view_notes").execute("notes-read", { note: "handoff" });
			assert.match(noteRead.content[0].text, /alpha gamma/);
			await assert.rejects(
				() => tools.get("orchestrator_create_note").execute("escape-note", { name: "../escape", content: "no" }),
				/plain names/,
			);
			assert.equal(fs.existsSync(path.join(cwd, "escape.md")), false);
		} finally {
			delete process.env.DESGRACA_ORCHESTRATOR_SESSION_ID;
			delete process.env.DESGRACA_ORCHESTRATOR_ROOT;
			delete process.env.DESGRACA_ORCHESTRATOR_CWD;
			delete process.env.DESGRACA_ORCHESTRATOR_SETTINGS;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("orchestrator tool policies and scope do not affect parent or worker contexts", async () => {
		const extension = (await importCompiled("index.js")).default;
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "orchestrator-policy-"));
		try {
			const parentHandlers = new Map();
			delete process.env.DESGRACA_ORCHESTRATOR_SESSION_ID;
			delete process.env.DESGRACA_ORCHESTRATOR_ROOT;
			delete process.env.DESGRACA_ORCHESTRATOR_CWD;
			delete process.env.DESGRACA_ORCHESTRATOR_SETTINGS;
			extension({
				on: (name, handler) => parentHandlers.set(name, handler),
				registerCommand: () => {},
				registerTool: () => {},
				appendEntry: () => {},
			});
			assert.equal(await parentHandlers.get("tool_call")({ toolName: "write", input: { path: "main.txt" } }, { cwd, hasUI: false }), undefined);

			await fsp.mkdir(path.join(cwd, ".agents", "_orchestrator"), { recursive: true });
			process.env.DESGRACA_ORCHESTRATOR_SESSION_ID = "session-1";
			process.env.DESGRACA_ORCHESTRATOR_ROOT = path.join(cwd, ".agents", "_orchestrator");
			process.env.DESGRACA_ORCHESTRATOR_CWD = cwd;
			process.env.DESGRACA_ORCHESTRATOR_SETTINGS = JSON.stringify(createDefaultSettings());
			const orchestratorHandlers = new Map();
			extension({
				on: (name, handler) => orchestratorHandlers.set(name, handler),
				registerCommand: () => {},
				registerTool: () => {},
				appendEntry: () => {},
			});
			const bashDenied = await orchestratorHandlers.get("tool_call")({ toolName: "bash", input: { command: "echo ok" } }, { cwd, hasUI: false });
			assert.equal(bashDenied?.block, true);
			assert.match(bashDenied?.reason ?? "", /Policy denies bash/);
			const writeDenied = await orchestratorHandlers.get("tool_call")({ toolName: "write", input: { path: "main.txt" } }, { cwd, hasUI: false });
			assert.equal(writeDenied?.block, true);
			assert.match(writeDenied?.reason ?? "", /not available to orchestrator/);
			const readProjectAllowed = await orchestratorHandlers.get("tool_call")({ toolName: "read", input: { path: "README.md" } }, { cwd, hasUI: false });
			assert.equal(readProjectAllowed, undefined);
			const readAgentsDenied = await orchestratorHandlers.get("tool_call")({ toolName: "read", input: { path: path.join(cwd, ".agents", "_orchestrator", "session.json") } }, { cwd, hasUI: false });
			assert.equal(readAgentsDenied?.block, true);
			assert.match(readAgentsDenied?.reason ?? "", /\.agents internals/);
		} finally {
			delete process.env.DESGRACA_ORCHESTRATOR_SESSION_ID;
			delete process.env.DESGRACA_ORCHESTRATOR_ROOT;
			delete process.env.DESGRACA_ORCHESTRATOR_CWD;
			delete process.env.DESGRACA_ORCHESTRATOR_SETTINGS;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

});
