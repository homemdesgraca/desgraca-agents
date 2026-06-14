import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, test } from "node:test";
import { setupCompiledProject } from "./helpers/test-utils.mjs";

const { projectRoot, importCompiled } = setupCompiledProject();

describe("blank-slate MVP foundations", () => {
	test("default policies allow read/search/agent-only tools and do not expose write/edit", async () => {
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const settings = createDefaultSettings();
		assert.equal(settings.toolPolicies.read, "allow");
		assert.equal(settings.toolPolicies.grep, "allow");
		assert.equal(settings.toolPolicies.find, "allow");
		assert.equal(settings.toolPolicies.ls, "allow");
		assert.equal(settings.toolPolicies.bash, "ask");
		assert.equal(settings.toolPolicies.write, undefined);
		assert.equal(settings.toolPolicies.edit, undefined);
		assert.equal(settings.toolPolicies.agent_write_proposal, "allow");
		assert.equal(settings.toolPolicies.agent_edit_proposal, "allow");
		assert.equal(settings.toolPolicies.agent_view_artifacts, "allow");
		assert.equal(settings.toolPolicies.agent_create_note, "allow");
		assert.equal(settings.toolPolicies.agent_edit_note, "allow");
		assert.equal(settings.toolPolicies.agent_view_notes, "allow");
		assert.deepEqual(settings.childRunnerTools, ["read", "grep", "find", "ls", "agent_write_proposal", "agent_edit_proposal", "agent_view_artifacts", "agent_create_note", "agent_edit_note", "agent_view_notes"]);
	});

	test("agent jobs are sanitized and isolated under .agents", async () => {
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-job-"));
		try {
			const job = createAgentJob(cwd, " Module X Worker! ", "  inspect module x  ");
			assert.equal(job.name, "module-x-worker");
			assert.equal(job.task, "inspect module x");
			assert.equal(job.readableRoot, path.resolve(cwd));
			assert.equal(job.writableRoot, path.join(cwd, ".agents", "module-x-worker"));
			assert.equal(job.status, "draft");
			assert.deepEqual(job.allowedTools, ["read", "grep", "find", "ls", "agent_write_proposal", "agent_edit_proposal", "agent_view_artifacts", "agent_create_note", "agent_edit_note", "agent_view_notes"]);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("scope guard permits reads in the project and writes only in the agent workspace", async () => {
		const { checkAgentReadScope, checkAgentWriteScope } = await importCompiled("src/permissions/scope-guard.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "scope-"));
		const job = { name: "worker", writableRoot: path.join(cwd, ".agents", "worker") };
		try {
			assert.equal(checkAgentReadScope(cwd, "src/index.ts").ok, true);
			assert.equal(checkAgentReadScope(cwd, "../outside.txt").ok, false);
			assert.equal(checkAgentWriteScope(job, "notes.md").absolutePath, path.join(job.writableRoot, "notes.md"));
			assert.equal(checkAgentWriteScope(job, "../outside.txt").ok, false);
			assert.equal(checkAgentWriteScope(job, path.join(job.writableRoot, "nested", "file.txt")).ok, true);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("risk warnings remain simple and focused on risky bash patterns", async () => {
		const { getBashRiskWarnings } = await importCompiled("src/permissions/risk-warnings.js");
		assert.deepEqual(getBashRiskWarnings("rm -rf build && curl https://example.test"), [
			"Warning: rm detected",
			"Warning: curl detected",
		]);
		assert.deepEqual(getBashRiskWarnings("grep -R TODO src"), []);
	});

	test("store tracks selection, approvals, logs, and final status timestamps", async () => {
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "store-"));
		try {
			const store = new AgentStore();
			let notifications = 0;
			const unsubscribe = store.subscribe(() => notifications++);
			const first = store.create(cwd, "first", "one");
			const second = store.create(cwd, "second", "two");
			assert.equal(store.getSelectedId(), second.id);
			store.selectByIndex(0);
			assert.equal(store.getSelectedId(), first.id);
			const approval = store.appendApproval(first.id, {
				agentId: first.id,
				agentName: first.name,
				toolName: "write",
				inputSummary: "notes.md",
				warnings: [],
				reason: "Policy requires approval.",
			});
			assert.equal(store.get(first.id).pendingApprovals[0].status, "pending");
			store.resolveApproval(first.id, approval.id, "approved");
			assert.equal(store.get(first.id).pendingApprovals[0].status, "approved");
			store.setStatus(first.id, "done");
			assert.equal(store.get(first.id).status, "done");
			assert.ok(store.get(first.id).finishedAt);
			assert.ok(store.get(first.id).logs.some((entry) => entry.message.includes("Approval approved")));
			await fsp.mkdir(path.join(first.writableRoot, "proposals"), { recursive: true });
			await fsp.writeFile(path.join(first.writableRoot, "proposals", "old.txt"), "old");
			const cleared = await store.clear(first.id);
			assert.equal(cleared.status, "draft");
			assert.equal(cleared.finalResponse, undefined);
			assert.equal(cleared.process, undefined);
			assert.deepEqual(cleared.artifacts, []);
			assert.equal(fs.existsSync(path.join(first.writableRoot, "proposals", "old.txt")), false);
			unsubscribe();
			assert.ok(notifications >= 6);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("artifact discovery only reports files from the agent workspace", async () => {
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const { AgentStore } = await importCompiled("src/agents/agent-store.js");
		const { discoverArtifacts, PiSubprocessAgentRunner } = await importCompiled("src/agents/agent-runner.js");
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "artifacts-"));
		try {
			const job = createAgentJob(cwd, "artifact worker", "produce notes");
			await fsp.mkdir(path.join(job.writableRoot, "proposals", "nested"), { recursive: true });
			await fsp.mkdir(path.join(job.writableRoot, "notes"), { recursive: true });
			await fsp.writeFile(path.join(job.writableRoot, "proposals", "nested", "notes.md"), "hello");
			await fsp.writeFile(path.join(job.writableRoot, "notes", "handoff.md"), "note");
			await fsp.writeFile(path.join(job.writableRoot, "agent-job.json.123.456.uuid.tmp"), "transient state write");
			await fsp.writeFile(path.join(cwd, "main-project.txt"), "must not be listed");
			const artifacts = await discoverArtifacts(job);
			assert.deepEqual(artifacts.map((artifact) => artifact.path), [
				path.join(".agents", "artifact-worker", "notes", "handoff.md"),
				path.join(".agents", "artifact-worker", "proposals", "nested", "notes.md"),
			]);
			assert.equal(artifacts[0].sizeBytes, 4);
			assert.equal(artifacts[0].kind, "note");
			assert.equal(artifacts[1].sizeBytes, 5);
			assert.equal(artifacts[1].kind, "proposal");
			assert.equal(artifacts[1].originalPath, path.join("nested", "notes.md"));
			assert.equal(artifacts.some((artifact) => artifact.path.includes("agent-job.json")), false);

			const store = new AgentStore();
			const liveJob = store.create(cwd, "live artifacts", "watch files");
			const runner = new PiSubprocessAgentRunner(store, createDefaultSettings);
			runner.running.set(liveJob.id, { process: { killed: false }, aborted: false });
			await fsp.mkdir(path.join(liveJob.writableRoot, "notes"), { recursive: true });
			await fsp.writeFile(path.join(liveJob.writableRoot, "notes", "live.md"), "live note");
			await runner.refreshArtifactsWhileRunning(liveJob.id);
			assert.ok(store.get(liveJob.id).artifacts.some((artifact) => artifact.path.endsWith(path.join("notes", "live.md"))));
			runner.running.delete(liveJob.id);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("dashboard renderers expose jobs, approvals, artifacts, and direct-key help", async () => {
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const { renderJobList, renderApprovals, renderArtifacts, renderArtifactContent, renderFooterHints, renderHelp } = await importCompiled("src/dashboard/render.js");
		const { parseDashboardAction } = await importCompiled("src/dashboard/keybindings.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "render-"));
		try {
			const job = createAgentJob(cwd, "render worker", "show ui");
			const artifactPath = path.join(job.writableRoot, "notes.md");
			const notePath = path.join(job.writableRoot, "notes", "handoff.md");
			await fsp.mkdir(path.dirname(notePath), { recursive: true });
			await fsp.writeFile(artifactPath, "line one\nline two");
			await fsp.writeFile(notePath, "handoff note");
			job.pendingApprovals.push({
				id: "approval-1",
				agentId: job.id,
				agentName: job.name,
				toolName: "bash",
				inputSummary: "rm -rf build",
				warnings: ["Warning: rm detected"],
				reason: "Policy requires approval.",
				status: "pending",
				createdAt: Date.now(),
			});
			job.artifacts.push({
				id: "artifact-1",
				agentId: job.id,
				path: path.join(".agents", job.name, "proposals", "notes.md"),
				absolutePath: artifactPath,
				sizeBytes: 17,
				updatedAt: Date.now(),
				kind: "proposal",
				originalPath: "notes.md",
			});
			job.artifacts.push({
				id: "artifact-2",
				agentId: job.id,
				path: path.join(".agents", job.name, "notes", "handoff.md"),
				absolutePath: notePath,
				sizeBytes: 12,
				updatedAt: Date.now(),
				kind: "note",
			});
			assert.match(renderJobList([job], job.id, 100).join("\n"), /approvals:1/);
			assert.match(renderApprovals(job, 100).join("\n"), /Warning: rm detected/);
			assert.match(renderArtifacts(job, 100).join("\n"), /original: notes\.md/);
			assert.match(renderArtifacts(job, 100).join("\n"), /notes.*handoff\.md/);
			assert.doesNotMatch(renderArtifacts(job, 100, undefined, 0, { showNotes: false }).join("\n"), /handoff\.md/);
			assert.match(renderArtifactContent(job.artifacts[0], 100).join("\n"), /line two/);
			assert.match(renderHelp(120).join("\n"), /C create/);
			assert.match(renderHelp(120).join("\n"), /1-9 still/);
			assert.deepEqual(parseDashboardAction("F"), { type: "artifacts" });
			assert.equal(parseDashboardAction("D"), undefined);
			assert.equal(parseDashboardAction("L"), undefined);
			assert.deepEqual(parseDashboardAction("T"), { type: "logs" });
			assert.deepEqual(parseDashboardAction("G"), { type: "normal" });
			assert.deepEqual(parseDashboardAction("Q"), { type: "previousMode" });
			assert.deepEqual(parseDashboardAction("E"), { type: "nextMode" });
			assert.deepEqual(parseDashboardAction("K"), { type: "clear" });
			assert.deepEqual(parseDashboardAction("3"), { type: "select", index: 2 });
			assert.deepEqual(parseDashboardAction("["), { type: "artifactPrevious" });
			assert.deepEqual(parseDashboardAction("]"), { type: "artifactNext" });
			assert.deepEqual(parseDashboardAction("\r"), { type: "artifactOpen" });
			assert.deepEqual(parseDashboardAction("V"), { type: "toggleNotes" });
			assert.doesNotMatch(renderFooterHints(120, undefined, "artifacts").join("\n"), /approve|deny/);
			assert.match(renderFooterHints(120, undefined, "artifacts").join("\n"), /V.*notes/);
			assert.doesNotMatch(renderFooterHints(120, undefined, "normal").join("\n"), /approve|deny/);
			assert.match(renderFooterHints(120, undefined, "normal").join("\n"), /K clear/);
			assert.match(renderFooterHints(120, undefined, "approvals").join("\n"), /approve/);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("artifact viewer builds colored-review diff lines without truncating content", async () => {
		const { ArtifactViewer, buildLineDiff } = await importCompiled("src/dashboard/artifact-viewer.js");
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "viewer-"));
		try {
			const job = createAgentJob(cwd, "viewer worker", "review artifact");
			const originalPath = path.join(cwd, "src", "file.txt");
			const proposalPath = path.join(job.writableRoot, "proposals", "src", "file.txt");
			await fsp.mkdir(path.dirname(originalPath), { recursive: true });
			await fsp.mkdir(path.dirname(proposalPath), { recursive: true });
			await fsp.writeFile(originalPath, "one\ntwo\nthree\n");
			await fsp.writeFile(proposalPath, "one\nTWO\nthree\nfour\n");
			const diff = buildLineDiff("one\ntwo\n", "one\nTWO\n").map((line) => line.text).join("\n");
			assert.match(diff, /- two/);
			assert.match(diff, /\+ TWO/);
			let closed = false;
			const viewer = new ArtifactViewer({
				job,
				artifact: {
					id: "artifact-1",
					agentId: job.id,
					path: path.join(".agents", job.name, "proposals", "src", "file.txt"),
					absolutePath: proposalPath,
					sizeBytes: 19,
					updatedAt: Date.now(),
					kind: "proposal",
					originalPath: path.join("src", "file.txt"),
				},
				viewportRows: 20,
				onClose: () => { closed = true; },
			});
			const rendered = viewer.render(100).join("\n");
			assert.match(rendered, /Artifact viewer/);
			assert.match(rendered, /DIFF/);
			assert.match(rendered, /wrap:\s*on/);
			assert.match(rendered, /final path: src\/file\.txt/);
			assert.match(rendered, /A.*accept/);
			assert.match(rendered, /- two/);
			assert.match(rendered, /\+ TWO/);
			viewer.handleInput("q");
			assert.equal(closed, true);

			const longWrappedContext = `same 0 ${"x".repeat(1000)}`;
			const lateOriginal = [longWrappedContext, ...Array.from({ length: 29 }, (_, index) => `same ${index + 1}`), "old", ""].join("\n");
			const lateProposal = [longWrappedContext, ...Array.from({ length: 29 }, (_, index) => `same ${index + 1}`), "new", ""].join("\n");
			await fsp.writeFile(originalPath, lateOriginal);
			await fsp.writeFile(proposalPath, lateProposal);
			const lateViewer = new ArtifactViewer({
				job,
				artifact: {
					id: "artifact-2",
					agentId: job.id,
					path: path.join(".agents", job.name, "proposals", "src", "file.txt"),
					absolutePath: proposalPath,
					sizeBytes: lateProposal.length,
					updatedAt: Date.now(),
					kind: "proposal",
					originalPath: path.join("src", "file.txt"),
				},
				viewportRows: 16,
				onClose: () => {},
			});
			const lateRendered = lateViewer.render(100).join("\n");
			assert.match(lateRendered, /- old/);
			assert.match(lateRendered, /\+ new/);
			assert.doesNotMatch(lateRendered, /same 0/);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("accepting a proposal writes the proposal to the final project path", async () => {
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const { acceptArtifactProposal } = await importCompiled("index.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "accept-artifact-"));
		try {
			const job = createAgentJob(cwd, "accept worker", "accept proposal");
			const proposalPath = path.join(job.writableRoot, "proposals", "src", "accepted.txt");
			await fsp.mkdir(path.dirname(proposalPath), { recursive: true });
			await fsp.writeFile(proposalPath, "accepted content\n");
			const message = await acceptArtifactProposal(job, {
				id: "artifact-1",
				agentId: job.id,
				path: path.join(".agents", job.name, "proposals", "src", "accepted.txt"),
				absolutePath: proposalPath,
				sizeBytes: 17,
				updatedAt: Date.now(),
				kind: "proposal",
				originalPath: path.join("src", "accepted.txt"),
			});
			assert.match(message, /Accepted proposal/);
			assert.equal(await fsp.readFile(path.join(cwd, "src", "accepted.txt"), "utf8"), "accepted content\n");

			const outsideSource = path.join(cwd, "outside-source.txt");
			await fsp.writeFile(outsideSource, "unexpected content\n");
			await assert.rejects(
				() => acceptArtifactProposal(job, {
					id: "artifact-2",
					agentId: job.id,
					path: "outside-source.txt",
					absolutePath: outsideSource,
					sizeBytes: 19,
					updatedAt: Date.now(),
					kind: "proposal",
					originalPath: path.join("src", "accepted.txt"),
				}),
				/unexpected source path/,
			);
			await assert.rejects(
				() => acceptArtifactProposal(job, {
					id: "artifact-3",
					agentId: job.id,
					path: path.join(".agents", job.name, "proposals", "src", "accepted.txt"),
					absolutePath: proposalPath,
					sizeBytes: 17,
					updatedAt: Date.now(),
					kind: "proposal",
					originalPath: path.join("src", "other.txt"),
				}),
				/unexpected source path/,
			);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("extension registers dashboard commands and keeps agent tools out of ordinary conversations", async () => {
		const extension = (await importCompiled("index.js")).default;
		const commands = new Map();
		const handlers = new Map();
		const tools = new Map();
		const entries = [];
		delete process.env.DESGRACA_AGENT_JOB_ID;
		delete process.env.DESGRACA_AGENT_NAME;
		delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
		extension({
			on: (name, handler) => handlers.set(name, handler),
			registerCommand: (name, spec) => commands.set(name, spec),
			registerTool: (spec) => tools.set(spec.name, spec),
			appendEntry: (type, data) => entries.push({ type, data }),
		});
		assert.ok(commands.has("agents"));
		assert.ok(commands.has("agent-settings"));
		assert.ok(commands.has("agent-policy-cycle"));
		assert.ok(handlers.has("tool_call"));
		assert.equal(tools.has("agent_write_proposal"), false);
		assert.equal(tools.has("agent_edit_proposal"), false);
		assert.equal(tools.has("agent_view_artifacts"), false);
		assert.equal(tools.has("agent_create_note"), false);
		assert.equal(tools.has("agent_edit_note"), false);
		assert.equal(tools.has("agent_view_notes"), false);

		const result = await handlers.get("tool_call")({ toolName: "write", input: { path: "main.txt" } }, { cwd: projectRoot });
		assert.equal(result, undefined);
	});

	test("extension registers agent-only tools only in marked agent subprocess contexts", async () => {
		const extension = (await importCompiled("index.js")).default;
		const tools = new Map();
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "extension-tools-"));
		try {
			process.env.DESGRACA_AGENT_JOB_ID = "agent-1";
			process.env.DESGRACA_AGENT_NAME = "proposal-worker";
			process.env.DESGRACA_AGENT_WRITABLE_ROOT = path.join(cwd, ".agents", "proposal-worker");
			extension({
				on: () => {},
				registerCommand: () => {},
				registerTool: (spec) => tools.set(spec.name, spec),
				appendEntry: () => {},
			});
			assert.ok(tools.has("agent_write_proposal"));
			assert.ok(tools.has("agent_edit_proposal"));
			assert.ok(tools.has("agent_view_artifacts"));
			assert.ok(tools.has("agent_create_note"));
			assert.ok(tools.has("agent_edit_note"));
			assert.ok(tools.has("agent_view_notes"));

			await fsp.mkdir(path.join(cwd, "src"), { recursive: true });
			await fsp.writeFile(path.join(cwd, "src", "file.ts"), "const value = 1;\n");
			await tools.get("agent_write_proposal").execute("tool-1", { originalPath: "src/new.ts", content: "export const value = 2;\n" }, undefined, undefined, { cwd });
			assert.equal(await fsp.readFile(path.join(cwd, ".agents", "proposal-worker", "proposals", "src", "new.ts"), "utf8"), "export const value = 2;\n");
			assert.equal(fs.existsSync(path.join(cwd, "src", "new.ts")), false);

			await tools.get("agent_edit_proposal").execute("tool-2", { originalPath: "src/file.ts", edits: [{ oldText: "const value = 1;", newText: "const value = 3;" }] }, undefined, undefined, { cwd });
			assert.equal(await fsp.readFile(path.join(cwd, ".agents", "proposal-worker", "proposals", "src", "file.ts"), "utf8"), "const value = 3;\n");
			assert.equal(await fsp.readFile(path.join(cwd, "src", "file.ts"), "utf8"), "const value = 1;\n");
			const listResult = await tools.get("agent_view_artifacts").execute("tool-3", {}, undefined, undefined, { cwd });
			assert.match(listResult.content[0].text, /proposal/);
			assert.match(listResult.content[0].text, /original: src\/file\.ts/);
			const diffResult = await tools.get("agent_view_artifacts").execute("tool-4", { path: "src/file.ts" }, undefined, undefined, { cwd });
			assert.match(diffResult.content[0].text, /- const value = 1;/);
			assert.match(diffResult.content[0].text, /\+ const value = 3;/);

			await tools.get("agent_create_note").execute("tool-5", { name: "handoff", content: "Initial findings\nTODO: review api\n" }, undefined, undefined, { cwd });
			assert.equal(await fsp.readFile(path.join(cwd, ".agents", "proposal-worker", "notes", "handoff.md"), "utf8"), "Initial findings\nTODO: review api\n");
			assert.equal(fs.existsSync(path.join(cwd, ".agents", "notes", "handoff.md")), false);
			const artifactListWithNote = await tools.get("agent_view_artifacts").execute("tool-5b", {}, undefined, undefined, { cwd });
			assert.match(artifactListWithNote.content[0].text, /note .*handoff\.md/);
			const notesList = await tools.get("agent_view_notes").execute("tool-6", {}, undefined, undefined, { cwd });
			assert.match(notesList.content[0].text, /handoff\.md/);
			const noteRead = await tools.get("agent_view_notes").execute("tool-7", { note: "handoff" }, undefined, undefined, { cwd });
			assert.match(noteRead.content[0].text, /Initial findings/);
			await tools.get("agent_edit_note").execute("tool-8", { note: "handoff", edits: [{ oldText: "TODO: review api", newText: "DONE: reviewed api" }] }, undefined, undefined, { cwd });
			assert.equal(await fsp.readFile(path.join(cwd, ".agents", "proposal-worker", "notes", "handoff.md"), "utf8"), "Initial findings\nDONE: reviewed api\n");
			await assert.rejects(
				() => tools.get("agent_create_note").execute("tool-9", { name: "../escape", content: "no" }, undefined, undefined, { cwd }),
				/plain names/,
			);
		} finally {
			delete process.env.DESGRACA_AGENT_JOB_ID;
			delete process.env.DESGRACA_AGENT_NAME;
			delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("agent-only proposal, artifact, and note tools are allowed by default without child UI", async () => {
		const extension = (await importCompiled("index.js")).default;
		const handlers = new Map();
		extension({
			on: (name, handler) => handlers.set(name, handler),
			registerCommand: () => {},
			appendEntry: () => {},
		});
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "extension-scope-allowed-"));
		try {
			process.env.DESGRACA_AGENT_JOB_ID = "agent-1";
			process.env.DESGRACA_AGENT_NAME = "scope-worker";
			process.env.DESGRACA_AGENT_WRITABLE_ROOT = path.join(cwd, ".agents", "scope-worker");
			const result = await handlers.get("tool_call")({ toolName: "agent_write_proposal", input: { originalPath: "src/file.ts" } }, { cwd, hasUI: false });
			assert.equal(result, undefined);
			const viewResult = await handlers.get("tool_call")({ toolName: "agent_view_artifacts", input: {} }, { cwd, hasUI: false });
			assert.equal(viewResult, undefined);
			const noteResult = await handlers.get("tool_call")({ toolName: "agent_create_note", input: { name: "handoff" } }, { cwd, hasUI: false });
			assert.equal(noteResult, undefined);
		} finally {
			delete process.env.DESGRACA_AGENT_JOB_ID;
			delete process.env.DESGRACA_AGENT_NAME;
			delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("generic agent writes inside the writable root still follow policy without child UI", async () => {
		const extension = (await importCompiled("index.js")).default;
		const handlers = new Map();
		extension({
			on: (name, handler) => handlers.set(name, handler),
			registerCommand: () => {},
			appendEntry: () => {},
		});
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "extension-write-policy-"));
		try {
			process.env.DESGRACA_AGENT_JOB_ID = "agent-1";
			process.env.DESGRACA_AGENT_NAME = "scope-worker";
			process.env.DESGRACA_AGENT_WRITABLE_ROOT = path.join(cwd, ".agents", "scope-worker");
			const input = { path: path.join(cwd, ".agents", "scope-worker", "notes.md") };
			const result = await handlers.get("tool_call")({ toolName: "write", input }, { cwd, hasUI: false });
			assert.equal(result?.block, true);
			assert.match(result?.reason ?? "", /No UI is available/);
			assert.equal(input.path, path.join(cwd, ".agents", "scope-worker", "notes.md"));
		} finally {
			delete process.env.DESGRACA_AGENT_JOB_ID;
			delete process.env.DESGRACA_AGENT_NAME;
			delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("agent-scoped write attempts outside the writable root are blocked before approval", async () => {
		const extension = (await importCompiled("index.js")).default;
		const handlers = new Map();
		extension({
			on: (name, handler) => handlers.set(name, handler),
			registerCommand: () => {},
			appendEntry: () => {},
		});
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "extension-scope-"));
		try {
			process.env.DESGRACA_AGENT_JOB_ID = "agent-1";
			process.env.DESGRACA_AGENT_NAME = "scope-worker";
			process.env.DESGRACA_AGENT_WRITABLE_ROOT = path.join(cwd, ".agents", "scope-worker");
			const result = await handlers.get("tool_call")(
				{ toolName: "write", input: { path: "../outside.txt" } },
				{ cwd, hasUI: false, ui: { confirm: async () => true } },
			);
			assert.equal(result?.block, true);
			assert.match(result?.reason ?? "", /Scope violation/);
		} finally {
			delete process.env.DESGRACA_AGENT_JOB_ID;
			delete process.env.DESGRACA_AGENT_NAME;
			delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

});
