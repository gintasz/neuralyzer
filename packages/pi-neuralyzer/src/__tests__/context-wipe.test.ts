/**
 * Deterministic unit tests for the context-wipe logic — no LLM, no network.
 *
 * Drives the extension with a mock ExtensionAPI: triggers neuralyze (via tool
 * and via command), then feeds synthetic message lists to the registered
 * `context` handler and asserts what the model would see.
 */
import { describe, it, expect, beforeEach } from "vitest";
import neuralyzerExtension from "../index.js";

type Msg = { role?: string; content?: unknown; timestamp?: number };
const text = (t: string) => [{ type: "text", text: t }];
const user = (t: string, ts = Date.now()): Msg => ({
	role: "user",
	content: text(t),
	timestamp: ts,
});
const assistant = (t: string, ts = Date.now()): Msg => ({
	role: "assistant",
	content: text(t),
	timestamp: ts,
});

interface Mock {
	pi: any;
	context: (messages: Msg[]) => Promise<Msg[]>;
	sessionStart: (entries: any[]) => Promise<void>;
	sent: Array<{ text: string; opts: any }>;
	appended: Array<{ customType: string; data: any }>;
	runTool: () => Promise<unknown>;
	runCommand: () => Promise<void>;
}

const FIRST = "What is the capital of France?";

function setup(firstMessageText = FIRST): Mock {
	let contextHandler: any;
	let sessionStartHandler: any;
	let toolDef: any;
	let commandDef: any;
	const sent: Array<{ text: string; opts: any }> = [];
	const appended: Array<{ customType: string; data: any }> = [];

	const pi: any = {
		registerCommand: (name: string, def: any) => {
			commandDef = { name, ...def };
		},
		registerTool: (def: any) => {
			toolDef = def;
		},
		on: (event: string, handler: any) => {
			if (event === "context") contextHandler = handler;
			if (event === "session_start") sessionStartHandler = handler;
		},
		sendUserMessage: (t: string, opts: any) => {
			sent.push({ text: t, opts });
		},
		appendEntry: (customType: string, data: any) => {
			appended.push({ customType, data });
		},
	};

	neuralyzerExtension(pi);

	const ctx: any = {
		ui: { notify: () => {} },
		sessionManager: {
			getEntries: () => [
				{ id: "u1", type: "message", message: user(firstMessageText) },
			],
		},
	};

	return {
		pi,
		sent,
		appended,
		context: async (messages: Msg[]) => {
			const result = await contextHandler({ type: "context", messages }, ctx);
			return (result as any)?.messages ?? messages;
		},
		sessionStart: async (entries: any[]) => {
			await sessionStartHandler(
				{ type: "session_start", reason: "startup" },
				{ sessionManager: { getEntries: () => entries } },
			);
		},
		runTool: () => toolDef.execute("call-1", {}, undefined, undefined, ctx),
		runCommand: () => commandDef.handler("", ctx),
	};
}

describe("neuralyzer context-wipe (deterministic)", () => {
	let m: Mock;
	beforeEach(() => {
		m = setup();
	});

	it("is inactive before triggering — passes context through untouched", async () => {
		const msgs = [user("hi"), assistant("yo")];
		expect(await m.context(msgs)).toBe(msgs);
	});

	it("tool re-sends the first message as a followUp", async () => {
		await m.runTool();
		expect(m.sent).toHaveLength(1);
		expect(m.sent[0].text).toBe(FIRST);
		expect(m.sent[0].opts).toEqual({ deliverAs: "followUp" });
	});

	it("persists a wipe marker so it survives restart", async () => {
		await m.runTool();
		expect(m.appended).toHaveLength(1);
		expect(m.appended[0].customType).toBe("neuralyzer:wipe");
		expect(m.appended[0].data).toEqual({ firstText: FIRST });
	});

	it("restores the wipe from the persisted marker on session_start (resume)", async () => {
		// Fresh instance = pi restarted; in-memory firstText is undefined.
		const fresh = setup();
		// Without restore, the full history (incl. tool result) would replay.
		const resumed: Msg[] = [
			user(FIRST),
			assistant("Paris"),
			user("secret 73914"),
			assistant("🕶️✨ Neuralyzer flashed."),
			user(FIRST), // the re-run
			assistant("Paris"),
			user("was neuralyzer called?"),
		];
		// Before restore: no wipe.
		expect(await fresh.context(resumed)).toBe(resumed);
		// Resume loads the persisted marker.
		await fresh.sessionStart([
			{ type: "custom", customType: "neuralyzer:wipe", data: { firstText: FIRST } },
		]);
		const out = await fresh.context(resumed);
		const flat = JSON.stringify(out);
		expect(flat).not.toContain("73914");
		expect(flat).not.toContain("Neuralyzer");
		expect(flat).toContain("was neuralyzer called?");
	});

	it("does not restore a wipe when no marker exists (normal resume)", async () => {
		const fresh = setup();
		await fresh.sessionStart([
			{ type: "message", message: user("hi") },
			{ type: "message", message: assistant("yo") },
		]);
		const msgs = [user("hi"), assistant("yo")];
		expect(await fresh.context(msgs)).toBe(msgs);
	});

	it("command re-sends the first message as a followUp", async () => {
		await m.runCommand();
		expect(m.sent).toHaveLength(1);
		expect(m.sent[0].text).toBe(FIRST);
	});

	it("hides everything before the re-run, including the tool result", async () => {
		await m.runTool();
		// Realistic sequence: original convo + the neuralyzer turn + the re-run.
		// Note the re-run's timestamp predates the tool_result (followUp is queued
		// inside execute) — the cut must be by position, not timestamp.
		const t = 1000;
		const messages: Msg[] = [
			user(FIRST, t), // original first
			assistant("Paris", t + 1),
			user("secret is 73914", t + 2),
			assistant("OK", t + 3),
			user("call neuralyzer", t + 4),
			assistant("🕶️✨ Neuralyzer flashed.", t + 6), // tool_result, LATER ts
			user(FIRST, t + 5), // the re-run, EARLIER ts than tool_result
		];
		const out = await m.context(messages);
		const flat = JSON.stringify(out);
		expect(out).toHaveLength(1);
		expect(flat).not.toContain("73914");
		expect(flat).not.toContain("Neuralyzer");
		expect(flat).toContain("capital of France");
	});

	it("keeps post-neuralyze turns while still hiding the old convo", async () => {
		await m.runTool();
		const messages: Msg[] = [
			user(FIRST), // original
			assistant("Paris"),
			user("secret is 73914"),
			assistant("🕶️✨ Neuralyzer flashed."),
			user(FIRST), // re-run
			assistant("Paris"),
			user("what were we talking about?"),
		];
		const out = await m.context(messages);
		const flat = JSON.stringify(out);
		expect(out[0].role).toBe("user");
		expect((out[0].content as any)[0].text).toBe(FIRST);
		expect(flat).not.toContain("73914");
		expect(flat).not.toContain("Neuralyzer");
		expect(flat).toContain("what were we talking about?");
	});

	it("works with a short first message ('hi') — picks the most recent re-run", async () => {
		const mh = setup("hi");
		await mh.runTool();
		const messages: Msg[] = [
			user("hi"), // original
			assistant("🕶️✨ Neuralyzer flashed."),
			user("hi"), // re-run
			assistant("yo"),
			user("highlight the bug"), // later, must NOT be mistaken for the cut
		];
		const out = await mh.context(messages);
		const flat = JSON.stringify(out);
		expect(out).toHaveLength(3); // re-run "hi", "yo", "highlight the bug"
		expect(flat).not.toContain("Neuralyzer");
		expect((out[0].content as any)[0].text).toBe("hi");
	});

	it("leaves a context with no re-run yet untouched (defensive)", async () => {
		await m.runTool();
		// Re-run hasn't landed; only the original first message is present.
		const messages: Msg[] = [user(FIRST), assistant("Paris"), user("noise")];
		// cut index === 0 (original first) → nothing hidden.
		expect(await m.context(messages)).toEqual(messages);
	});
});
