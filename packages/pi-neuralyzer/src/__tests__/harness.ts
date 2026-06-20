/**
 * Closed-loop e2e harness for @gintasz/pi-neuralyzer.
 *
 * neuralyzer wipes the agent's view of the conversation via a `context` event
 * handler (rewriting the LLM-visible message list) and re-runs the first
 * message — it does NOT fork. So tests assert on what the MODEL SEES, captured
 * by a recorder extension registered AFTER neuralyzer (so it observes the
 * already-stripped message list).
 *
 * The bare `createAgentSession()` SDK helper doesn't fully wire a host, so this
 * builds the runtime the way pi's own modes do
 * (`createAgentSessionServices` + `createAgentSessionFromServices` +
 * `createAgentSessionRuntime`) and binds command-context actions.
 */
import {
	AuthStorage,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	getAgentDir,
	createAgentSessionServices,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import neuralyzerExtension from "../index.js";

export const TEST_PROVIDER = "openrouter";
export const TEST_MODEL_ID = "deepseek/deepseek-v4-flash";

export interface NeuralyzerHarness {
	readonly session: any;
	/** Send a prompt and drain any re-run turn the extension triggers. */
	prompt(text: string): Promise<void>;
	/** Assistant text responses, in order. */
	readonly responses: string[];
	/** Tool names the LLM invoked, in order. */
	readonly toolCalls: string[];
	/** The message list the LLM saw on the most recent call (post-wipe). */
	llmContext(): Array<{ role?: string; content?: unknown }>;
	dispose(): void;
}

export async function hasModelAuth(): Promise<boolean> {
	try {
		const model = getModel(TEST_PROVIDER, TEST_MODEL_ID);
		if (!model) return false;
		const registry = ModelRegistry.create(AuthStorage.create());
		const auth = await registry.getApiKeyAndHeaders(model);
		return Boolean(auth.ok && auth.apiKey);
	} catch {
		return false;
	}
}

/** Flatten an LLM message / entry content to text. */
export function flatten(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p: any) => (p && p.type === "text" ? (p.text ?? "") : ""))
		.join("\n");
}

export async function createNeuralyzerHarness(): Promise<NeuralyzerHarness> {
	const model = getModel(TEST_PROVIDER, TEST_MODEL_ID);
	if (!model) throw new Error(`Model ${TEST_PROVIDER}/${TEST_MODEL_ID} not found`);

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});

	let recordedContext: Array<{ role?: string; content?: unknown }> = [];
	// Recorder runs AFTER neuralyzer in emitContext order, so it captures the
	// message list the LLM actually receives (already wiped).
	const recorder = (pi: ExtensionAPI) => {
		pi.on("context", async (event: any) => {
			recordedContext = event.messages;
		});
	};

	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		authStorage,
		modelRegistry,
		settingsManager,
		resourceLoaderOptions: {
			extensionFactories: [neuralyzerExtension, recorder],
		},
	});

	const sessionManager = SessionManager.inMemory(cwd);

	const createRuntime = async (opts: any) => {
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: opts.sessionManager,
			sessionStartEvent: opts.sessionStartEvent,
			model,
			thinkingLevel: "off",
		});
		return { ...created, services, diagnostics: [] };
	};

	const runtime: any = await createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager,
	});

	const responses: string[] = [];
	const toolCalls: string[] = [];
	let current = "";
	let unsubscribe: (() => void) | undefined;
	const uiContext: any = new Proxy({}, { get: () => () => {} });

	const bind = async () => {
		const s = runtime.session;
		await s.bindExtensions({
			uiContext,
			mode: "tui",
			abortHandler: () => {},
			commandContextActions: {
				waitForIdle: () => s.agent.waitForIdle(),
				newSession: (o: any) => runtime.newSession(o),
				fork: (id: string, o: any) => runtime.fork(id, o),
				navigateTree: (id: string, o: any) => s.navigateTree(id, o),
				switchSession: (p: string, o: any) => runtime.switchSession(p, o),
				reload: () => Promise.resolve(),
			},
		});
		unsubscribe = s.subscribe((event: any) => {
			if (event.type === "tool_execution_start") toolCalls.push(event.toolName);
			if (
				event.type === "message_update" &&
				event.assistantMessageEvent?.type === "text_delta"
			) {
				current += event.assistantMessageEvent.delta;
			}
			if (event.type === "message_end" && event.message.role === "assistant") {
				responses.push(current);
				current = "";
			}
		});
	};

	runtime.setRebindSession(async () => {
		unsubscribe?.();
		await bind();
	});
	await bind();

	const drain = async () => {
		// A command-triggered neuralyze re-runs the first message via a
		// fire-and-forget followUp. Let it start, then wait it out. (Tool-
		// triggered re-runs complete within the originating prompt already.)
		for (let i = 0; i < 4; i++) {
			await new Promise((r) => setTimeout(r, 40));
			await runtime.session.agent.waitForIdle();
		}
	};

	return {
		get session() {
			return runtime.session;
		},
		async prompt(text: string) {
			await runtime.session.prompt(text);
			await drain();
		},
		responses,
		toolCalls,
		llmContext: () => recordedContext,
		dispose: () => unsubscribe?.(),
	};
}

/** Whether the LLM-visible context contains the needle anywhere. */
export function contextContains(
	harness: NeuralyzerHarness,
	needle: string,
): boolean {
	return harness
		.llmContext()
		.some((m) => flatten(m.content).includes(needle));
}

/** User-message texts in the LLM-visible context. */
export function contextUserMessages(harness: NeuralyzerHarness): string[] {
	return harness
		.llmContext()
		.filter((m) => m.role === "user")
		.map((m) => flatten(m.content).trim());
}
