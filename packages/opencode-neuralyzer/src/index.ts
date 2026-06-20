/**
 * @gintasz/opencode-neuralyzer — OpenCode harness extension for the neuralyzer tool.
 *
 * Registers:
 * - `neuralyzer` tool: LLM-callable, returns the neuralyzer flash message.
 *   The actual context wipe is handled by the messages.transform hook.
 *
 * The wipe logic detects a completed neuralyzer tool call in the message list
 * and slices the LLM-visible messages to keep only the first user message.
 * Shared constants live in @gintasz/neuralyzer-core.
 */

import type { PluginModule } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import {
	NEURALYZER_TOOL_NAME,
	NEURALYZER_TOOL_DESCRIPTION,
	NEURALYZER_RESULT_TEXT,
} from "@gintasz/neuralyzer-core";
import { createMessagesTransform } from "./transform.js";

const plugin: PluginModule = {
	id: "neuralyzer",
	server: async (_input, _options) => {
		return {
			tool: {
				[NEURALYZER_TOOL_NAME]: tool({
					description: NEURALYZER_TOOL_DESCRIPTION,
					args: {},
					async execute(_args, _context) {
						return NEURALYZER_RESULT_TEXT;
					},
				}),
			},
			"experimental.chat.messages.transform": createMessagesTransform(),
		};
	},
};

export default plugin;
