/**
 * @gintasz/pi-neuralyzer — pi harness extension for the neuralyzer tool.
 *
 * Registers:
 * - `neuralyzer` tool: LLM-callable, re-runs the first message + wipes context
 * - `/neuralyzer` command: same effect, user-typed
 *
 * The wipe is harness-agnostic intent; only the pi wiring lives here. Shared
 * copy and the first-message extraction live in @gintasz/neuralyzer-core.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
	type MessageRole,
} from "@gintasz/neuralyzer-core";

// ---------------------------------------------------------------------------
// Helpers — adapt pi's native entry/content shapes to @gintasz/neuralyzer-core.
// ---------------------------------------------------------------------------

interface SessionEntry {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
}

interface ContentBlock {
	type?: string;
	text?: string;
}

/** Flatten pi/LLM content (string or text blocks) to plain text. */
function flattenText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

/** Text of the first user message in a pi session, or undefined. */
function firstUserMessageText(entries: SessionEntry[]): string | undefined {
	const mapped: MessageEntry[] = entries
		.filter(
			(e) =>
				e.type === "message" &&
				(e.message?.role === "user" || e.message?.role === "assistant"),
		)
		.map((e) => ({
			role: e.message!.role as MessageRole,
			text: flattenText(e.message!.content),
		}));
	return extractFirstUserMessage(mapped);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function neuralyzerExtension(pi: ExtensionAPI) {
	// --- Session-scoped state (pi reloads extensions per session) -----------
	//
	// A pi tool CANNOT fork/replace the session — fork() lives only on
	// command-handler context, never on tool or event context. And forwarding
	// a slash command from a tool is impossible (sendUserMessage injects literal
	// text, it never dispatches commands). So neuralyzer does NOT fork. Instead:
	//
	//   1. On trigger (tool OR command) we re-send the first user message so the
	//      agent re-runs it as if for the first time.
	//   2. A `context` handler — fired before every LLM call, allowed to rewrite
	//      the message list — drops everything older than that re-run, so the
	//      model never sees the wiped conversation (not even that neuralyzer was
	//      used). This works from a tool in stock pi; no host bridge required.
	//   3. The wipe is persisted as a custom session entry and restored on
	//      `session_start`, so it survives pi restart / session resume. Without
	//      this the in-memory state is lost on reload and the full history
	//      (including the neuralyzer tool result) replays.

	/** Custom session-entry type used to persist the wipe across restarts. */
	const WIPE_MARKER = "neuralyzer:wipe";

	/**
	 * Text of the first user message. Set once neuralyze is triggered; the
	 * `context` handler then hides everything before the most recent re-run of
	 * this message. `undefined` means neuralyzer is inactive (no wipe).
	 */
	let firstText: string | undefined;

	/** Re-send the first message and activate the context wipe. */
	function neuralyze(text: string): void {
		firstText = text;
		// Persist the wipe so it survives a pi restart / session resume (the
		// `firstText` above is in-memory only). Not sent to the LLM.
		pi.appendEntry(WIPE_MARKER, { firstText: text });
		// followUp is safe whether the agent is idle (runs now) or streaming
		// (runs right after the current turn — e.g. the tool's own turn).
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	}

	// Restore an active wipe after restart/resume/reload from the persisted
	// marker, so the context handler keeps hiding the old conversation.
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries() as Array<{
			type?: string;
			customType?: string;
			data?: { firstText?: string };
		}>;
		for (let i = entries.length - 1; i >= 0; i--) {
			const e = entries[i];
			if (
				e.type === "custom" &&
				e.customType === WIPE_MARKER &&
				typeof e.data?.firstText === "string"
			) {
				firstText = e.data.firstText;
				return;
			}
		}
	});

	pi.registerCommand("neuralyzer", {
		description: "Wipe session context and restart from the first user message",
		handler: async (_args, ctx) => {
			const first = firstUserMessageText(
				ctx.sessionManager.getEntries() as SessionEntry[],
			);
			if (!first) {
				ctx.ui.notify(NEURALYZER_NO_MESSAGE_ERROR, "error");
				return;
			}
			ctx.ui.notify(NEURALYZER_RESULT_TEXT, "info");
			neuralyze(first);
		},
	});

	pi.registerTool({
		name: NEURALYZER_TOOL_NAME,
		label: "Neuralyzer",
		description: NEURALYZER_TOOL_DESCRIPTION,
		promptSnippet: NEURALYZER_TOOL_PROMPT_SNIPPET,
		promptGuidelines: [...NEURALYZER_TOOL_PROMPT_GUIDELINES],
		parameters: Type.Object({}),

		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
			const first = firstUserMessageText(
				ctx.sessionManager.getEntries() as SessionEntry[],
			);
			if (!first) {
				throw new Error(NEURALYZER_NO_MESSAGE_ERROR);
			}

			neuralyze(first);

			return {
				content: [{ type: "text" as const, text: NEURALYZER_RESULT_TEXT }],
				details: { firstMessage: first },
				// End this turn cleanly; the re-run runs as the next turn.
				terminate: true,
			};
		},
	});

	// The actual wipe: rewrite the LLM-visible message list before every call.
	// Keep only the most recent re-run of the first message and everything
	// after it — so the model never sees the wiped conversation, nor that
	// neuralyzer was used. Anchored by content position (not timestamp): the
	// re-run's queued timestamp can predate the tool-result that precedes it.
	pi.on("context", async (event) => {
		if (firstText === undefined) return;
		const messages = event.messages as Array<{
			role?: string;
			content?: unknown;
		}>;

		const cut = neuralyzeCutIndex(
			messages.map((m) => ({ role: m.role, text: flattenText(m.content) })),
			firstText,
		);
		// cut === 0 → re-run already first (or not present yet); nothing to hide.
		if (cut > 0) {
			return { messages: messages.slice(cut) as typeof event.messages };
		}
		return;
	});
}
