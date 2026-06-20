import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
	createE2EHarness,
	hasOpencode,
	type E2EHarness,
} from "./harness.js";

const live = hasOpencode();
const describeLive = live ? describe : describe.skip;

if (!live) {
	console.warn("[neuralyzer e2e] skipped — opencode CLI not found.");
}

describeLive("opencode-neuralyzer e2e", () => {
	let h: E2EHarness;

	beforeAll(async () => {
		h = await createE2EHarness();
	}, 30_000);

	afterAll(async () => {
		await h?.close();
	});

	it("loads the built plugin in a real OpenCode server", async () => {
		const result = await h.client.tool.ids();
		expect(result.error).toBeUndefined();
		expect(result.data).toContain("neuralyzer");
	});
});
