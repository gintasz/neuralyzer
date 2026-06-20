import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface E2EHarness {
	client: OpencodeClient;
	serverUrl: string;
	close(): Promise<void>;
}

const STARTUP_TIMEOUT = 15_000;
const SCRATCH_ROOT = "/tmp/agentic_coding";

export function hasOpencode(): boolean {
	const result = spawnSync("opencode", ["--version"], { stdio: "ignore" });
	return result.status === 0;
}

export async function createE2EHarness(): Promise<E2EHarness> {
	fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
	const tmpDir = fs.mkdtempSync(path.join(SCRATCH_ROOT, "neuralyzer-e2e-"));
	const projectDir = path.join(tmpDir, "project");
	const homeDir = path.join(tmpDir, "home");
	const configDir = path.join(projectDir, ".opencode");
	fs.mkdirSync(configDir, { recursive: true });
	fs.mkdirSync(homeDir, { recursive: true });

	const pluginDist = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../dist/index.js",
	);
	if (!fs.existsSync(pluginDist)) {
		throw new Error(`Built plugin not found at ${pluginDist}; run npm run build`);
	}

	fs.writeFileSync(
		path.join(projectDir, "opencode.json"),
		JSON.stringify(
			{
				$schema: "https://opencode.ai/config.json",
				plugin: [pathToFileURL(pluginDist).href],
			},
			null,
			2,
		),
	);

	const port = await getFreePort();
	const serverUrl = `http://127.0.0.1:${port}`;
	const serverOutput: string[] = [];
	const server = spawn(
		"opencode",
		["serve", "--port", String(port), "--hostname", "127.0.0.1"],
		{
			cwd: projectDir,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				HOME: homeDir,
				XDG_CONFIG_HOME: path.join(homeDir, ".config"),
				XDG_CACHE_HOME: path.join(homeDir, ".cache"),
				XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
				XDG_STATE_HOME: path.join(homeDir, ".local", "state"),
				OPENCODE_CONFIG_DIR: configDir,
			},
		},
	);
	server.stdout?.on("data", (d: Buffer) => serverOutput.push(d.toString()));
	server.stderr?.on("data", (d: Buffer) => serverOutput.push(d.toString()));

	const client = createOpencodeClient({ baseUrl: serverUrl });
	await waitForToolIds(client, server, serverOutput);

	return {
		client,
		serverUrl,
		async close() {
			await stopServer(server);
			fs.rmSync(tmpDir, { recursive: true, force: true });
		},
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Could not allocate port")));
				return;
			}
			const { port } = address;
			server.close(() => resolve(port));
		});
	});
}

async function waitForToolIds(
	client: OpencodeClient,
	server: ChildProcess,
	serverOutput: string[],
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < STARTUP_TIMEOUT) {
		if (server.exitCode !== null) break;
		try {
			const result = await client.tool.ids();
			if (!result.error && result.data?.includes("neuralyzer")) return;
		} catch {
			// Server is still starting.
		}
		await sleep(250);
	}
	throw new Error(
		`OpenCode server did not expose the neuralyzer tool within ${STARTUP_TIMEOUT}ms.\n` +
			serverOutput.join(""),
	);
}

async function stopServer(server: ChildProcess): Promise<void> {
	if (server.exitCode !== null) return;
	const exited = new Promise<void>((resolve) => {
		server.once("exit", () => resolve());
	});
	server.kill("SIGTERM");
	await Promise.race([
		exited,
		sleep(2_000).then(() => {
			if (server.exitCode === null) server.kill("SIGKILL");
		}),
	]);
}
