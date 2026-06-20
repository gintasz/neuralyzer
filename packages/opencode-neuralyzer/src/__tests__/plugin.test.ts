/**
 * Plugin module structure verification tests.
 *
 * Import the built plugin module and verify it exports the correct shape
 * expected by OpenCode's plugin loader.
 */

import { describe, it, expect } from "vitest";
// Import the TypeScript source directly for testing
import plugin from "../index.js";

describe("neuralyzer plugin module", () => {
	it("is a valid PluginModule", () => {
		expect(plugin).toBeDefined();
		expect(typeof plugin).toBe("object");
		expect(plugin).toHaveProperty("id");
		expect(plugin).toHaveProperty("server");
		expect(typeof plugin.server).toBe("function");
	});

	it("has id 'neuralyzer'", () => {
		expect(plugin.id).toBe("neuralyzer");
	});

	it("server returns hooks with tool and transform", async () => {
		const hooks = await plugin.server({} as any, {} as any);

		expect(hooks).toBeDefined();
		expect(hooks).toHaveProperty("tool");
		expect(hooks.tool).toHaveProperty("neuralyzer");

		const neuralyzerTool = hooks.tool!.neuralyzer;
		expect(neuralyzerTool.description).toContain("Restart");
		expect(neuralyzerTool.args).toEqual({});

		// Execute should return the flash message
		const result = await neuralyzerTool.execute({}, {} as any);
		expect(typeof result).toBe("string");
		expect(result).toContain("🕶️");
	});

	it("server returns experimental.chat.messages.transform hook", async () => {
		const hooks = await plugin.server({} as any, {} as any);

		expect(hooks).toHaveProperty("experimental.chat.messages.transform");
		expect(typeof hooks["experimental.chat.messages.transform"]).toBe(
			"function",
		);
	});

	it("transform hook does nothing on empty messages", async () => {
		const hooks = await plugin.server({} as any, {} as any);
		const transform = hooks["experimental.chat.messages.transform"]!;

		const output = { messages: [] as any[] };
		await transform({}, output);
		expect(output.messages).toHaveLength(0);
	});

	it("transform hook wipes context when neuralyzer tool completed", async () => {
		const hooks = await plugin.server({} as any, {} as any);
		const transform = hooks["experimental.chat.messages.transform"]!;

		const messages = [
			{
				info: { id: "1", role: "user", sessionID: "s" } as any,
				parts: [{ id: "p1", type: "text", text: "First message" } as any],
			},
			{
				info: { id: "2", role: "assistant", sessionID: "s" } as any,
				parts: [
					{
						id: "p2",
						type: "tool",
						tool: "neuralyzer",
						state: { status: "completed" },
					} as any,
				],
			},
		];

		const output = { messages: [...messages] };
		await transform({}, output as any);

		expect(output.messages).toHaveLength(1);
		expect((output.messages[0].info as any).role).toBe("user");
	});
});
