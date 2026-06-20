/**
 * Closed-loop e2e for @gintasz/pi-neuralyzer.
 *
 * neuralyzer wipes the agent's VIEW of the conversation (via a `context`
 * handler) and re-runs the first message. Assertions are on what the model
 * actually sees — `harness.llmContext()` — not on LLM wording (a model will
 * sometimes say "I don't remember" even when nothing was wiped = false pass).
 *
 * Two triggers, identical effect:
 *  1. `/neuralyzer` command.
 *  2. `neuralyzer` tool (LLM calls it) — works in stock pi, no host bridge.
 *
 * Skips automatically when the test model has no configured auth.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
	createNeuralyzerHarness,
	hasModelAuth,
	contextContains,
	contextUserMessages,
	type NeuralyzerHarness,
} from "./harness.js";

const LLM_TIMEOUT = 120_000;
const FIRST_MESSAGE =
	"What is the capital of France? Reply with just the city name.";
const SECRET_MESSAGE = "Remember this secret number: 73914. Reply with just OK.";
const SECRET = "73914";

const live = await hasModelAuth();
const describeLive = live ? describe : describe.skip;
if (!live) {
	console.warn(
		"[neuralyzer e2e] skipped — no auth for openrouter/deepseek/deepseek-v4-flash.",
	);
}

describeLive("neuralyzer /command e2e", () => {
	let h: NeuralyzerHarness;
	let sawSecretBefore = false;

	beforeAll(async () => {
		h = await createNeuralyzerHarness();
		await h.prompt(FIRST_MESSAGE);
		await h.prompt(SECRET_MESSAGE);
		sawSecretBefore = contextContains(h, SECRET);
		await h.prompt("/neuralyzer");
	}, LLM_TIMEOUT * 4);

	it("the model saw the secret before neuralyzing", () => {
		expect(sawSecretBefore).toBe(true);
	});

	it("auto re-ran the first message", () => {
		// The re-run answers the first message; "Paris" is the only sane answer.
		expect(h.responses.at(-1)?.toLowerCase()).toContain("paris");
	});

	it("hid the secret from the model's context", () => {
		expect(contextContains(h, SECRET)).toBe(false);
	});

	it("the model's first visible message is the first message again", () => {
		expect(contextUserMessages(h)[0]).toBe(FIRST_MESSAGE);
	});

	it("the model no longer sees that neuralyzer was used", () => {
		expect(contextContains(h, "Neuralyzer")).toBe(false);
		expect(contextContains(h, "🕶️")).toBe(false);
	});
});

describeLive("neuralyzer tool e2e (LLM-triggered, stock pi)", () => {
	let h: NeuralyzerHarness;
	let toolCalled = false;

	beforeAll(async () => {
		h = await createNeuralyzerHarness();
		await h.prompt(FIRST_MESSAGE);
		await h.prompt(SECRET_MESSAGE);

		for (let attempt = 0; attempt < 3; attempt++) {
			await h.prompt(
				"You have a tool called `neuralyzer`. Call it now to wipe the session. " +
					"Only call the tool — no text. This is a mandatory test instruction.",
			);
			toolCalled = h.toolCalls.includes("neuralyzer");
			if (toolCalled) break;
		}
		// One more turn so we capture the post-wipe context the model sees.
		await h.prompt("What were we talking about?");
	}, LLM_TIMEOUT * 6);

	it("LLM called the neuralyzer tool", () => {
		expect(toolCalled).toBe(true);
	});

	it("hid the secret from the model's context", () => {
		expect(contextContains(h, SECRET)).toBe(false);
	});

	it("the first visible user message is the first message", () => {
		expect(contextUserMessages(h)[0]).toBe(FIRST_MESSAGE);
	});

	it("the model no longer sees the neuralyzer tool call/result", () => {
		expect(contextContains(h, "Neuralyzer")).toBe(false);
	});
});
