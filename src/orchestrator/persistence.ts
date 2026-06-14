import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function atomicTempPath(filePath: string): string {
	return `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
	await ensureDir(path.dirname(filePath));
	const lockPath = `${filePath}.lock`;
	const start = Date.now();
	let handle: fs.FileHandle | undefined;
	while (!handle) {
		try {
			handle = await fs.open(lockPath, "wx");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for lock: ${lockPath}`);
			await sleep(25);
		}
	}
	try {
		await handle.writeFile(`${process.pid}\n${Date.now()}\n`, "utf8");
		return await fn();
	} finally {
		await handle.close().catch(() => undefined);
		await fs.rm(lockPath, { force: true }).catch(() => undefined);
	}
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
	await ensureDir(path.dirname(filePath));
	const tmpPath = atomicTempPath(filePath);
	await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
	await fs.rename(tmpPath, filePath);
}

export async function writeTextFileAtomic(filePath: string, value: string): Promise<void> {
	await ensureDir(path.dirname(filePath));
	const tmpPath = atomicTempPath(filePath);
	await fs.writeFile(tmpPath, value, "utf8");
	await fs.rename(tmpPath, filePath);
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
	await ensureDir(path.dirname(filePath));
	await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function readJsonLines<T>(filePath: string, limit = 200): Promise<T[]> {
	try {
		const text = await fs.readFile(filePath, "utf8");
		const lines = text.split("\n").filter((line) => line.trim().length > 0);
		return lines.slice(-limit).flatMap((line) => {
			try {
				return [JSON.parse(line) as T];
			} catch {
				return [];
			}
		});
	} catch {
		return [];
	}
}
