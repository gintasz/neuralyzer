/**
 * Unit tests for the messages transform hook.
 *
 * Tests the neuralyzer detection and context-wipe logic by constructing
 * mock message arrays with various scenarios.
 */

import { describe, it, expect } from "vitest";
import { createMessagesTransform } from "../transform.js";

// ---------------------------------------------------------------------------
// Helpers to construct mock messages matching the OpenCode types
// ---------------------------------------------------------------------------

interface MockTextPart {
	id: string;
	type: "text";
	text: string;
	sessionID: string;
	messageID: string;
}

interface MockToolPart {
	id: string;
	type: "tool";
	tool: string;
	callID: string;
	sessionID: string;
	messageID: string;
	state: {
		status: "pending" | "running" | "completed" | "error";
		input?: Record<string, unknown>;
		output?: string;
	};
}

type MockPart = MockTextPart | MockToolPart;

interface MockUserMessage {
	id: string;
	sessionID: string;
	role: "user";
	time: { created: number };
	agent: string;
	model: { providerID: string; modelID: string };
}

interface MockAssistantMessage {
	id: string;
	sessionID: string;
	role: "assistant";
	time: { created: number };
	parentID: string;
	modelID: string;
	providerID: string;
	mode: string;
	path: { cwd: string; root: string };
	cost: number;
	tokens: {
		input: number;
		output: number;
		reasoning: number;
		cache: { read: number; write: number };
	};
}

type MockMessage = MockUserMessage | MockAssistantMessage;

interface MockMessageWithParts {
	info: MockMessage;
	parts: MockPart[];
}

let idCounter = 0;
function nextId(): string {
	return `msg-${++idCounter}`;
}

function userMsg(text: string): MockMessageWithParts {
	const mid = nextId();
	return {
		info: {
			id: mid,
			sessionID: "sess-1",
			role: "user",
			time: { created: Date.now() },
			agent: "main",
			model: { providerID: "openai", modelID: "gpt-4" },
		},
		parts: [
			{
				id: `part-${mid}`,
				type: "text",
				text,
				sessionID: "sess-1",
				messageID: mid,
			},
		],
	};
}

function assistantMsg(parts: MockPart[]): MockMessageWithParts {
	const mid = nextId();
	return {
		info: {
			id: mid,
			sessionID: "sess-1",
			role: "assistant",
			time: { created: Date.now() },
			parentID: "parent-1",
			modelID: "gpt-4",
			providerID: "openai",
			mode: "default",
			path: { cwd: "/test", root: "/test" },
			cost: 0,
			tokens: {
				input: 0,
				output: 0,
				reasoning: 0,
				cache: { read: 0, write: 0 },
			},
		},
		parts,
	};
}

function textPart(text: string): MockTextPart {
	return {
		id: `part-${nextId()}`,
		type: "text",
		text,
		sessionID: "sess-1",
		messageID: "msg-0",
	};
}

function neuralyzerToolPart(
	status: "completed" | "pending" | "running" | "error" = "completed",
): MockToolPart {
	return {
		id: `tool-${nextId()}`,
		type: "tool",
		tool: "neuralyzer",
		callID: `call-${nextId()}`,
		sessionID: "sess-1",
		messageID: "msg-0",
		state: { status },
	};
}

function otherToolPart(): MockToolPart {
	return {
		id: `tool-${nextId()}`,
		type: "tool",
		tool: "read",
		callID: `call-${nextId()}`,
		sessionID: "sess-1",
		messageID: "msg-0",
		state: { status: "completed" },
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createMessagesTransform", () => {
	const transform = createMessagesTransform();

	it("does nothing when no neuralyzer tool call present", async () => {
		const messages: MockMessageWithParts[] = [
			userMsg("Hello, how are you?"),
			assistantMsg([textPart("I'm doing well!")]),
			userMsg("Read the file"),
			assistantMsg([otherToolPart()]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(4);
		expect(output.messages).toEqual(messages);
	});

	it("does nothing for empty message list", async () => {
		const output = { messages: [] as any[] };
		await transform({}, output);
		expect(output.messages).toHaveLength(0);
	});

	it("wipes context when neuralyzer tool call is completed", async () => {
		const firstMsg = userMsg("Check if PR exists; if not, neuralyze.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([textPart("Let me check..."), otherToolPart()]),
			assistantMsg([neuralyzerToolPart("completed")]),
			assistantMsg([textPart("Neuralyzer has flashed.")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		// Should keep the first user message and post-flash assistant continuation.
		expect(output.messages).toHaveLength(2);
		expect(output.messages[0]).toEqual(firstMsg);
		expect(output.messages[1]).toEqual(messages[3]);
	});

	it("mutates the existing messages array in place for OpenCode", async () => {
		const firstMsg = userMsg("Start here.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			userMsg("Call neuralyzer."),
			assistantMsg([neuralyzerToolPart("completed")]),
		];
		const output = { messages: [...messages] as any };
		const originalArray = output.messages;

		await transform({}, output);

		expect(output.messages).toBe(originalArray);
		expect(originalArray).toHaveLength(1);
		expect(originalArray[0]).toEqual(firstMsg);
	});

	it("keeps later user turns after the neuralyzer response", async () => {
		const firstMsg = userMsg("hi");
		const postFlashAssistant = assistantMsg([
			neuralyzerToolPart("completed"),
			textPart("Hi"),
		]);
		const laterQuestion = userMsg("was neuralyzer tool used in this conversation?");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([textPart("Hi.")]),
			userMsg("call neuralyzer"),
			postFlashAssistant,
			laterQuestion,
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(3);
		expect(output.messages[0]).toEqual(firstMsg);
		expect(output.messages[1].info).toEqual(postFlashAssistant.info);
		expect(output.messages[1].parts).toEqual([postFlashAssistant.parts[1]]);
		expect(output.messages[2]).toEqual(laterQuestion);
	});

	it("does not wipe when neuralyzer tool call is still pending", async () => {
		const firstMsg = userMsg("Check and neuralyze if needed.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([neuralyzerToolPart("pending")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(2);
	});

	it("does not wipe when neuralyzer tool call is running", async () => {
		const firstMsg = userMsg("Check and neuralyze.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([neuralyzerToolPart("running")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(2);
	});

	it("does not wipe when neuralyzer tool call errored", async () => {
		const firstMsg = userMsg("Try to neuralyze.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([neuralyzerToolPart("error")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(2);
	});

	it("keeps first user message when multiple user messages exist before neuralyzer", async () => {
		const firstMsg = userMsg("First message.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([textPart("Response 1")]),
			userMsg("Second message."),
			assistantMsg([textPart("Response 2")]),
			userMsg("Third message — now neuralyze."),
			assistantMsg([neuralyzerToolPart("completed")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(1);
		expect(output.messages[0]).toEqual(firstMsg);
	});

	it("handles neuralyzer as the only tool in an assistant message", async () => {
		const firstMsg = userMsg("Neuralyze now.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([neuralyzerToolPart("completed")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(1);
		expect(output.messages[0]).toEqual(firstMsg);
	});

	it("detects neuralyzer among multiple tool calls in same assistant message", async () => {
		const firstMsg = userMsg("Do several things, then neuralyze.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([
				otherToolPart(),
				neuralyzerToolPart("completed"),
				otherToolPart(),
			]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(1);
	});

	it("wipes to first message even when neuralyzer appears in later assistant message", async () => {
		const firstMsg = userMsg("Initial query.");
		const messages: MockMessageWithParts[] = [
			firstMsg,
			assistantMsg([textPart("Processing...")]),
			userMsg("More work."),
			assistantMsg([otherToolPart()]),
			userMsg("Now neuralyze."),
			assistantMsg([textPart("OK")]),
			assistantMsg([neuralyzerToolPart("completed")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		expect(output.messages).toHaveLength(1);
		expect(output.messages[0]).toEqual(firstMsg);
	});

	it("does nothing when there are no user messages at all (edge case)", async () => {
		// This shouldn't happen in practice but we should handle it gracefully
		const messages: MockMessageWithParts[] = [
			assistantMsg([neuralyzerToolPart("completed")]),
		];

		const output = { messages: [...messages] as any };
		await transform({}, output);

		// No user message to wipe to, so no change
		expect(output.messages).toHaveLength(1);
	});
});
