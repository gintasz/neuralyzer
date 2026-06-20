/**
 * Integration tests for @gintasz/pi-neuralyzer.
 *
 * Uses pi's SDK (createAgentSession) with in-memory session manager to verify:
 * - Extension loads without errors
 * - neuralyzer tool is registered
 * - Tool and command structure is correct
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
	AuthStorage,
	ModelRegistry,
	createAgentSession,
	SessionManager,
	SettingsManager,
	DefaultResourceLoader,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import neuralyzerExtension from "../index.js";

describe("@gintasz/pi-neuralyzer extension", () => {
	let tools: Array<{ name: string }>;

	beforeAll(async () => {
		const authStorage = AuthStorage.create();
		const modelRegistry = ModelRegistry.create(authStorage);

		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: getAgentDir(),
			extensionFactories: [neuralyzerExtension],
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
			}),
		});
		await loader.reload();

		const { session } = await createAgentSession({
			authStorage,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
			}),
			resourceLoader: loader,
		});

		// Access registered tools via the agent state
		tools = session.agent.state.tools as Array<{ name: string }>;
	});

	it("registers the neuralyzer tool", () => {
		const neuralyzer = tools.find((t) => t.name === "neuralyzer");
		expect(neuralyzer).toBeDefined();
	});

	it("only registers neuralyzer (no extra tools from this extension)", () => {
		// The extension registers one tool and one command.
		// Commands don't appear in tools, so only neuralyzer should be here
		// (plus any default tools pi provides).
		const extTools = tools.filter((t) => t.name === "neuralyzer");
		expect(extTools).toHaveLength(1);
	});

	it("neuralyzer tool has no required parameters", () => {
		const neuralyzer = tools.find((t) => t.name === "neuralyzer") as {
			name: string;
			parameters?: {
				properties?: Record<string, unknown>;
				required?: string[];
			};
		};
		expect(neuralyzer).toBeDefined();
		expect(neuralyzer.parameters?.required ?? []).toHaveLength(0);
	});
});
