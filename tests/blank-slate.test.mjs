import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(import.meta.dirname, "..");
const piNodeModules = "/usr/lib/node_modules/pi/node_modules";
const compiledRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "desgraca-agents-tests-"));
const sourceNodeModules = path.join(projectRoot, "node_modules");
const sourceEarendil = path.join(sourceNodeModules, "@earendil-works");
const sourceTypebox = path.join(sourceNodeModules, "typebox");
let hadSourceEarendil = false;
let hadSourceTypebox = false;
let hadSourceNodeModules = false;

async function ensurePiNodeModulesLink(root) {
	const target = path.join(root, "node_modules");
	await fsp.mkdir(target, { recursive: true });
	const link = path.join(target, "@earendil-works");
	try {
		await fsp.lstat(link);
		await fsp.rm(link, { recursive: true, force: true });
	} catch {}
	await fsp.symlink(path.join(piNodeModules, "@earendil-works"), link, "dir");
	const typeboxLink = path.join(target, "typebox");
	try {
		await fsp.lstat(typeboxLink);
		await fsp.rm(typeboxLink, { recursive: true, force: true });
	} catch {}
	await fsp.symlink(path.join(piNodeModules, "typebox"), typeboxLink, "dir");
}

async function importCompiled(relativePath) {
	return import(pathToFileURL(path.join(compiledRoot, relativePath)).href);
}

before(async () => {
	hadSourceNodeModules = fs.existsSync(sourceNodeModules);
	hadSourceEarendil = fs.existsSync(sourceEarendil);
	hadSourceTypebox = fs.existsSync(sourceTypebox);
	if (!hadSourceEarendil) {
		await fsp.mkdir(sourceNodeModules, { recursive: true });
		await fsp.symlink(path.join(piNodeModules, "@earendil-works"), sourceEarendil, "dir");
	}
	if (!hadSourceTypebox) {
		await fsp.mkdir(sourceNodeModules, { recursive: true });
		await fsp.symlink(path.join(piNodeModules, "typebox"), sourceTypebox, "dir");
	}

	execFileSync(
		"tsc",
		[
			"--target",
			"ES2022",
			"--module",
			"ES2022",
			"--moduleResolution",
			"Bundler",
			"--allowImportingTsExtensions",
			"--rewriteRelativeImportExtensions",
			"--skipLibCheck",
			"--esModuleInterop",
			"--outDir",
			compiledRoot,
			"--rootDir",
			projectRoot,
			"index.ts",
			"src/agents/agent-env.ts",
			"src/agents/agent-job.ts",
			"src/agents/agent-runner.ts",
			"src/agents/agent-store.ts",
			"src/agents/proposal-tools.ts",
			"src/dashboard/artifact-viewer.ts",
			"src/dashboard/Dashboard.ts",
			"src/dashboard/keybindings.ts",
			"src/dashboard/render.ts",
			"src/permissions/policies.ts",
			"src/permissions/risk-warnings.ts",
			"src/permissions/scope-guard.ts",
			"src/settings/settings.ts",
		],
		{ cwd: projectRoot, stdio: "pipe" },
	);
	await fsp.writeFile(path.join(compiledRoot, "package.json"), JSON.stringify({ type: "module" }));
	await ensurePiNodeModulesLink(compiledRoot);
});

after(async () => {
	delete process.env.DESGRACA_AGENT_JOB_ID;
	delete process.env.DESGRACA_AGENT_NAME;
	delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
	delete process.env.DESGRACA_AGENT_SETTINGS;
	if (!hadSourceEarendil) await fsp.rm(sourceEarendil, { recursive: true, force: true });
	if (!hadSourceTypebox) await fsp.rm(sourceTypebox, { recursive: true, force: true });
	if (!hadSourceNodeModules) await fsp.rm(sourceNodeModules, { recursive: true, force: true });
	await fsp.rm(compiledRoot, { recursive: true, force: true });
});

describe("blank-slate MVP foundations", () => {
	test("default policies allow read/search and ask before bash/write/edit", async () => {
		const { createDefaultSettings } = await importCompiled("src/settings/settings.js");
		const settings = createDefaultSettings();
		assert.equal(settings.toolPolicies.read, "allow");
		assert.equal(settings.toolPolicies.grep, "allow");
		assert.equal(settings.toolPolicies.find, "allow");
		assert.equal(settings.toolPolicies.ls, "allow");
		assert.equal(settings.toolPolicies.bash, "ask");
		assert.equal(settings.toolPolicies.write, "ask");
		assert.equal(settings.toolPolicies.edit, "ask");
		assert.equal(settings.toolPolicies.agent_write_proposal, "allow");
		assert.equal(settings.toolPolicies.agent_edit_proposal, "allow");
		assert.deepEqual(settings.childRunnerTools, ["read", "grep", "find", "ls", "write", "agent_write_proposal", "agent_edit_proposal"]);
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
			assert.deepEqual(job.allowedTools, ["read", "grep", "find", "ls", "write", "agent_write_proposal", "agent_edit_proposal"]);
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
			unsubscribe();
			assert.ok(notifications >= 6);
		} finally {
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("artifact discovery only reports files from the agent workspace", async () => {
		const { createAgentJob } = await importCompiled("src/agents/agent-job.js");
		const { discoverArtifacts } = await importCompiled("src/agents/agent-runner.js");
		const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "artifacts-"));
		try {
			const job = createAgentJob(cwd, "artifact worker", "produce notes");
			await fsp.mkdir(path.join(job.writableRoot, "proposals", "nested"), { recursive: true });
			await fsp.writeFile(path.join(job.writableRoot, "proposals", "nested", "notes.md"), "hello");
			await fsp.writeFile(path.join(cwd, "main-project.txt"), "must not be listed");
			const artifacts = await discoverArtifacts(job);
			assert.deepEqual(artifacts.map((artifact) => artifact.path), [path.join(".agents", "artifact-worker", "proposals", "nested", "notes.md")]);
			assert.equal(artifacts[0].sizeBytes, 5);
			assert.equal(artifacts[0].kind, "proposal");
			assert.equal(artifacts[0].originalPath, path.join("nested", "notes.md"));
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
			await fsp.mkdir(job.writableRoot, { recursive: true });
			await fsp.writeFile(artifactPath, "line one\nline two");
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
			assert.match(renderJobList([job], job.id, 100).join("\n"), /approvals:1/);
			assert.match(renderApprovals(job, 100).join("\n"), /Warning: rm detected/);
			assert.match(renderArtifacts(job, 100).join("\n"), /original: notes\.md/);
			assert.match(renderArtifactContent(job.artifacts[0], 100).join("\n"), /line two/);
			assert.match(renderHelp(120).join("\n"), /C create/);
			assert.match(renderHelp(120).join("\n"), /still selects agents/);
			assert.deepEqual(parseDashboardAction("F"), { type: "artifacts" });
			assert.equal(parseDashboardAction("D"), undefined);
			assert.equal(parseDashboardAction("L"), undefined);
			assert.deepEqual(parseDashboardAction("T"), { type: "logs" });
			assert.deepEqual(parseDashboardAction("G"), { type: "normal" });
			assert.deepEqual(parseDashboardAction("3"), { type: "select", index: 2 });
			assert.deepEqual(parseDashboardAction("["), { type: "artifactPrevious" });
			assert.deepEqual(parseDashboardAction("]"), { type: "artifactNext" });
			assert.deepEqual(parseDashboardAction("O"), { type: "artifactOpen" });
			assert.deepEqual(parseDashboardAction("\r"), { type: "artifactOpen" });
			assert.doesNotMatch(renderFooterHints(120, undefined, "artifacts").join("\n"), /approve|deny/);
			assert.doesNotMatch(renderFooterHints(120, undefined, "normal").join("\n"), /approve|deny/);
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
			assert.match(rendered, /- two/);
			assert.match(rendered, /\+ TWO/);
			viewer.handleInput("q");
			assert.equal(closed, true);
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

		const result = await handlers.get("tool_call")({ toolName: "write", input: { path: "main.txt" } }, { cwd: projectRoot });
		assert.equal(result, undefined);
	});

	test("extension registers proposal tools only in marked agent subprocess contexts", async () => {
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

			await fsp.mkdir(path.join(cwd, "src"), { recursive: true });
			await fsp.writeFile(path.join(cwd, "src", "file.ts"), "const value = 1;\n");
			await tools.get("agent_write_proposal").execute("tool-1", { originalPath: "src/new.ts", content: "export const value = 2;\n" }, undefined, undefined, { cwd });
			assert.equal(await fsp.readFile(path.join(cwd, ".agents", "proposal-worker", "proposals", "src", "new.ts"), "utf8"), "export const value = 2;\n");
			assert.equal(fs.existsSync(path.join(cwd, "src", "new.ts")), false);

			await tools.get("agent_edit_proposal").execute("tool-2", { originalPath: "src/file.ts", edits: [{ oldText: "const value = 1;", newText: "const value = 3;" }] }, undefined, undefined, { cwd });
			assert.equal(await fsp.readFile(path.join(cwd, ".agents", "proposal-worker", "proposals", "src", "file.ts"), "utf8"), "const value = 3;\n");
			assert.equal(await fsp.readFile(path.join(cwd, "src", "file.ts"), "utf8"), "const value = 1;\n");
		} finally {
			delete process.env.DESGRACA_AGENT_JOB_ID;
			delete process.env.DESGRACA_AGENT_NAME;
			delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
			await fsp.rm(cwd, { recursive: true, force: true });
		}
	});

	test("agent proposal tools are allowed by default without child UI", async () => {
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
