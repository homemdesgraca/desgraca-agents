import { execFileSync } from "node:child_process";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before } from "node:test";
import { pathToFileURL } from "node:url";

const sourceFiles = [
	"index.ts",
	"src/agents/agent-env.ts",
	"src/agents/agent-job.ts",
	"src/agents/agent-runner.ts",
	"src/agents/agent-store.ts",
	"src/agents/proposal-tools.ts",
	"src/dashboard/artifact-viewer.ts",
	"src/dashboard/clear-agent-dialog.ts",
	"src/dashboard/clear-orchestrator-session-dialog.ts",
	"src/dashboard/create-job-dialog.ts",
	"src/dashboard/create-orchestrator-session-dialog.ts",
	"src/dashboard/Dashboard.ts",
	"src/dashboard/delete-agent-dialog.ts",
	"src/dashboard/delete-orchestrator-session-dialog.ts",
	"src/dashboard/edit-orchestrator-session-dialog.ts",
	"src/dashboard/keybindings.ts",
	"src/dashboard/render.ts",
	"src/dashboard/render-orchestrator.ts",
	"src/dashboard/tracking-message-dialog.ts",
	"src/orchestrator/orchestrator-env.ts",
	"src/orchestrator/orchestrator-runner.ts",
	"src/orchestrator/orchestrator-session.ts",
	"src/orchestrator/orchestrator-store.ts",
	"src/orchestrator/orchestrator-tools.ts",
	"src/orchestrator/persistence.ts",
	"src/permissions/policies.ts",
	"src/permissions/risk-warnings.ts",
	"src/permissions/scope-guard.ts",
	"src/settings/settings.ts",
];

export function setupCompiledProject() {
	const projectRoot = path.resolve(import.meta.dirname, "../..");
	const piNodeModules = "/usr/lib/node_modules/pi/node_modules";
	let compiledRoot;

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

	before(async () => {
		compiledRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "desgraca-agents-tests-"));
		const tsconfigPath = path.join(compiledRoot, "tsconfig.test.json");
		await fsp.writeFile(tsconfigPath, JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ES2022",
				moduleResolution: "Bundler",
				allowImportingTsExtensions: true,
				rewriteRelativeImportExtensions: true,
				skipLibCheck: true,
				esModuleInterop: true,
				outDir: compiledRoot,
				rootDir: projectRoot,
				baseUrl: projectRoot,
				ignoreDeprecations: "6.0",
				typeRoots: [path.join(piNodeModules, "@types")],
				types: ["node"],
				paths: {
					"@earendil-works/pi-coding-agent": ["/usr/lib/node_modules/pi/packages/coding-agent/dist/index.d.ts"],
					"@earendil-works/pi-tui": ["/usr/lib/node_modules/pi/packages/tui/dist/index.d.ts"],
					"typebox": ["/usr/lib/node_modules/pi/node_modules/typebox/build/index.d.mts"],
				},
			},
			files: sourceFiles.map((file) => path.join(projectRoot, file)),
		}, null, 2));
		execFileSync("tsc", ["-p", tsconfigPath], { cwd: projectRoot, stdio: "pipe" });
		await fsp.writeFile(path.join(compiledRoot, "package.json"), JSON.stringify({ type: "module" }));
		await ensurePiNodeModulesLink(compiledRoot);
	});

	after(async () => {
		delete process.env.DESGRACA_AGENT_JOB_ID;
		delete process.env.DESGRACA_AGENT_NAME;
		delete process.env.DESGRACA_AGENT_WRITABLE_ROOT;
		delete process.env.DESGRACA_AGENT_SETTINGS;
		delete process.env.DESGRACA_ORCHESTRATOR_SESSION_ID;
		delete process.env.DESGRACA_ORCHESTRATOR_ROOT;
		delete process.env.DESGRACA_ORCHESTRATOR_CWD;
		delete process.env.DESGRACA_ORCHESTRATOR_SETTINGS;
		delete process.env.DESGRACA_ORCHESTRATOR_MODEL;
		if (compiledRoot) await fsp.rm(compiledRoot, { recursive: true, force: true });
	});

	return {
		projectRoot,
		importCompiled(relativePath) {
			if (!compiledRoot) throw new Error("Compiled project is not ready yet.");
			return import(pathToFileURL(path.join(compiledRoot, relativePath)).href);
		},
	};
}
