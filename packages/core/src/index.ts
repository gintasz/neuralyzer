/**
 * @gintasz/neuralyzer-core — Harness-agnostic shared types and utilities for the neuralyzer tool.
 *
 * Neuralyzer clears all agent session context except the first user message,
 * then re-runs that first message. Like the memory-wiping device from Men in Black,
 * but for AI agent conversations.
 */

/** The canonical tool name. All harness implementations MUST use this name. */
export const NEURALYZER_TOOL_NAME = "neuralyzer";

/** Human-readable description shown to the LLM in the system prompt. */
export const NEURALYZER_TOOL_DESCRIPTION =
	"Restart the conversation from the user's first message, discarding everything since. " +
	"Call this ONLY when the user explicitly tells you to neuralyze — never on your own " +
	"initiative, and never when the user did not ask for it. Call it at the point the " +
	"user's instructions place it (this is often the final step, after completing the " +
	"requested work), with no preamble and no confirmation.";

/** Tool result text returned to the LLM after neuralyzer executes. */
export const NEURALYZER_RESULT_TEXT = "🕶️✨ Neuralyzer has flashed.";

/** One-line snippet for the tool in a harness's "Available tools" section. */
export const NEURALYZER_TOOL_PROMPT_SNIPPET =
	"Restart the session from the user's first message — only when the user explicitly tells you to neuralyze; never on your own.";

/** Guideline bullets a harness appends to the system prompt when active. */
export const NEURALYZER_TOOL_PROMPT_GUIDELINES: readonly string[] = [
];

/** Shown when neuralyze is triggered but the session has no user message. */
export const NEURALYZER_NO_MESSAGE_ERROR =
	"There is nothing to neuralyze. No user message found in session.";


/** Known message roles. */
export type MessageRole = "user" | "assistant";

/**
 * A minimal message entry shape expected from any harness adapter.
 * Harness-specific packages map their native entry types to this interface.
 */
export interface MessageEntry {
	role: MessageRole;
	/** Text content. Content blocks may be nested — harness adapters flatten them. */
	text: string;
}

/**
 * Extract the text of the first user message from a list of entries.
 * Returns `undefined` when no user message exists.
 */
export function extractFirstUserMessage(
	entries: MessageEntry[],
): string | undefined {
	for (const entry of entries) {
		if (entry.role === "user" && entry.text.trim().length > 0) {
			return entry.text.trim();
		}
	}
	return undefined;
}

/** A message with an optional role and already-flattened text. */
export interface RoledMessage {
	role?: string;
	text: string;
}

/**
 * Compute where to cut the LLM-visible message list so the model sees only the
 * most recent re-run of the first message and everything after it — hiding the
 * wiped conversation (and that neuralyzer ran).
 *
 * Returns the index of that re-run; the caller keeps `messages.slice(index)`.
 * Returns `0` when the re-run is already first or not present yet — i.e. there
 * is nothing to hide. Anchored by content (the last user message equal to
 * `firstText`), not timestamp: the re-run's timestamp can predate the
 * tool-result that precedes it in the list.
 */
export function neuralyzeCutIndex(
	messages: RoledMessage[],
	firstText: string,
): number {
	const target = firstText.trim();
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "user" && m.text.trim() === target) return i;
	}
	return 0;
}