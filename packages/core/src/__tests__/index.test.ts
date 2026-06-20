import { describe, it, expect } from "vitest";
import {
	NEURALYZER_TOOL_NAME,
	NEURALYZER_TOOL_DESCRIPTION,
	NEURALYZER_RESULT_TEXT,
	NEURALYZER_TOOL_PROMPT_SNIPPET,
	NEURALYZER_TOOL_PROMPT_GUIDELINES,
	NEURALYZER_NO_MESSAGE_ERROR,
	extractFirstUserMessage,
	neuralyzeCutIndex,
	type MessageEntry,
	type RoledMessage,
} from "../index.js";

describe("@gintasz/neuralyzer-core", () => {
	describe("constants", () => {
		it("NEURALYZER_TOOL_NAME is 'neuralyzer'", () => {
			expect(NEURALYZER_TOOL_NAME).toBe("neuralyzer");
		});

		it("NEURALYZER_TOOL_DESCRIPTION is non-empty", () => {
			expect(NEURALYZER_TOOL_DESCRIPTION.length).toBeGreaterThan(50);
		});

		it("NEURALYZER_RESULT_TEXT is non-empty", () => {
			expect(NEURALYZER_RESULT_TEXT.length).toBeGreaterThan(0);
		});

		it("prompt snippet is non-empty", () => {
			expect(NEURALYZER_TOOL_PROMPT_SNIPPET.length).toBeGreaterThan(0);
		});

		it("prompt guidelines are an array of non-empty strings (may be empty)", () => {
			expect(Array.isArray(NEURALYZER_TOOL_PROMPT_GUIDELINES)).toBe(true);
			for (const g of NEURALYZER_TOOL_PROMPT_GUIDELINES) {
				expect(g.trim().length).toBeGreaterThan(0);
			}
		});

		it("no-message error is non-empty", () => {
			expect(NEURALYZER_NO_MESSAGE_ERROR.length).toBeGreaterThan(0);
		});
	});

	describe("neuralyzeCutIndex", () => {
		const u = (text: string): RoledMessage => ({ role: "user", text });
		const a = (text: string): RoledMessage => ({ role: "assistant", text });

		it("returns the index of the most recent re-run of the first message", () => {
			const messages: RoledMessage[] = [
				u("first"),
				a("Paris"),
				u("secret 73914"),
				a("🕶️✨ Neuralyzer flashed."),
				u("first"), // the re-run
				a("Paris"),
				u("what now?"),
			];
			expect(neuralyzeCutIndex(messages, "first")).toBe(4);
		});

		it("returns 0 when the re-run is already first (nothing to hide)", () => {
			expect(neuralyzeCutIndex([u("first"), a("Paris")], "first")).toBe(0);
		});

		it("returns 0 when the first message is not present yet", () => {
			expect(neuralyzeCutIndex([u("other"), a("x")], "first")).toBe(0);
		});

		it("picks the latest match for short messages, ignores later non-matches", () => {
			const messages: RoledMessage[] = [
				u("hi"),
				a("flashed"),
				u("hi"), // re-run at index 2
				a("yo"),
				u("highlight the bug"),
			];
			expect(neuralyzeCutIndex(messages, "hi")).toBe(2);
		});

		it("ignores assistant messages that echo the first text", () => {
			const messages: RoledMessage[] = [u("first"), a("first")];
			expect(neuralyzeCutIndex(messages, "first")).toBe(0);
		});
	});

	describe("extractFirstUserMessage", () => {
		it("returns first user message text", () => {
			const entries: MessageEntry[] = [
				{ role: "assistant", text: "System prompt" },
				{ role: "user", text: "Hello, world!" },
				{ role: "assistant", text: "Hi there!" },
				{ role: "user", text: "Second message" },
			];
			expect(extractFirstUserMessage(entries)).toBe("Hello, world!");
		});

		it("returns undefined when no user message", () => {
			expect(extractFirstUserMessage([])).toBeUndefined();
			expect(
				extractFirstUserMessage([{ role: "assistant", text: "x" }]),
			).toBeUndefined();
		});

		it("skips blank user messages", () => {
			const entries: MessageEntry[] = [
				{ role: "user", text: "   " },
				{ role: "user", text: "Real message" },
			];
			expect(extractFirstUserMessage(entries)).toBe("Real message");
		});

		it("trims whitespace", () => {
			const entries: MessageEntry[] = [{ role: "user", text: "  padded  " }];
			expect(extractFirstUserMessage(entries)).toBe("padded");
		});
	});
});
