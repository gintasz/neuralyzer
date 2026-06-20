/**
 * Messages transform hook for neuralyzer.
 *
 * Scans the LLM-bound message list for a completed neuralyzer tool call.
 * When found, slices the list to keep only the first user message — the
 * model sees a fresh conversation with no trace of the wipe.
 */

import type { Message, Part } from "@opencode-ai/sdk";
import { NEURALYZER_TOOL_NAME } from "@gintasz/neuralyzer-core";

interface MessageWithParts {
	info: Message;
	parts: Part[];
}

interface TransformOutput {
	messages: MessageWithParts[];
}

function isCompletedNeuralyzerPart(part: Part): boolean {
	return (
		(part.type as string) === "tool" &&
		"tool" in part &&
		part.tool === NEURALYZER_TOOL_NAME &&
		"state" in part &&
		typeof part.state === "object" &&
		part.state !== null &&
		"status" in part.state &&
		part.state.status === "completed"
	);
}

function textPartsOnly(message: MessageWithParts): MessageWithParts | undefined {
	const parts = message.parts.filter((part) => part.type === "text");
	if (parts.length === 0) return undefined;
	return { info: message.info, parts };
}

/**
 * Scan messages for a completed neuralyzer tool call and, if found,
 * remove everything before the latest completed neuralyzer call.
 *
 * This is the core neuralyzer logic for OpenCode. Unlike pi, which
 * injects a follow-up message + filters context, OpenCode lacks a
 * follow-up injection API. Instead, OpenCode continues the same assistant
 * turn after the tool call; future turns keep that post-flash assistant
 * text and every later message.
 */
export function createMessagesTransform(): (
	_input: Record<string, never>,
	output: TransformOutput,
) => Promise<void> {
	return async (_input, output) => {
		const messages = output.messages;
		if (messages.length === 0) return;

		// 1. Find the first user message (for potential wipe)
		let firstUserIndex = -1;
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].info.role === "user") {
				firstUserIndex = i;
				break;
			}
		}
		if (firstUserIndex === -1) return; // No user message to wipe to

		// 2. Find the latest completed neuralyzer tool call. Earlier flashes are
		//    already obsolete once a later one exists.
		let neuralyzerMessageIndex = -1;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.info.role !== "assistant") continue;
			if (msg.parts.some(isCompletedNeuralyzerPart)) {
				neuralyzerMessageIndex = i;
				break;
			}
		}

		if (neuralyzerMessageIndex === -1) return;

		const wipedMessages = [messages[firstUserIndex]];
		const postFlashAssistant = textPartsOnly(messages[neuralyzerMessageIndex]);
		if (postFlashAssistant) wipedMessages.push(postFlashAssistant);
		wipedMessages.push(...messages.slice(neuralyzerMessageIndex + 1));

		// 3. Mutate the existing array in place. OpenCode hook outputs are shared
		//    mutable objects; replacing the property can be ignored by the caller.
		messages.splice(0, messages.length, ...wipedMessages);
	};
}
