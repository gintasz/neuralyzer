# ADR 0001 — Wipe agent context by rewriting the LLM message list, not by forking the session

- Status: Accepted
- Date: 2026-06-19
- Scope: `@gintasz/pi-neuralyzer` (pi harness extension only — not the harness-agnostic `@gintasz/neuralyzer-core`)
- Verified against: `@earendil-works/pi-coding-agent` v0.79.8

## Context

Neuralyzer must clear the agent's memory back to the **first user message** and
re-run it, so the agent behaves as if seeing that message for the first time.

It has two triggers that must both work:

1. The LLM-callable **`neuralyzer` tool** (the user says "call neuralyzer").
2. The **`/neuralyzer` command** (user-typed).

The LLM-driven, self-looping use case (a prompt that ends with "call neuralyzer"
to start the next iteration) can **only** use the tool: the model emits tool
calls, it cannot dispatch slash commands. So the tool path is primary.

## Decision

Implement the wipe **without forking**:

1. On trigger, re-send the first user message via
   `pi.sendUserMessage(firstText, { deliverAs: "followUp" })` so the agent
   re-runs it.
2. Register `on("context")` — fired before every LLM call and allowed to rewrite
   the message list — and return only the slice from the most recent re-run of
   the first message onward. The model never sees the wiped conversation (nor
   that neuralyzer ran). Cut anchored by **content** (last user message equal to
   the first message), not timestamp.
3. Persist the wipe as a custom session entry (`pi.appendEntry`) and restore it
   on `session_start`, so it survives pi restart / session resume.

## Why not fork (the considered alternative)

Forking is the architecturally cleaner option and was the original design.
`ctx.fork(entryId, { position: "before" })` branches the session into a new file
that **physically omits** the first message and everything after it; re-sending
the first message then gives a genuinely clean session. No hidden-message
retention, no growing file, no O(n) context rewrite per call.

It is rejected **for now** because a pi **tool cannot reach `fork()`**:

- `fork()` (and `newSession`/`navigateTree`/`switchSession`) exist **only** on
  command-handler context (`ExtensionCommandContext`) and the `withSession`
  callback. Tool `execute` and all event handlers receive
  `runner.createContext()` (see `core/extensions/wrapper.js:13`), which has no
  fork. Their `sessionManager` is read-only.
- A tool cannot dispatch the `/neuralyzer` command either:
  `pi.sendUserMessage("/neuralyzer")` calls `prompt(..., { expandPromptTemplates:
  false })`, which injects the literal text "/neuralyzer" as a user turn — it
  never runs the command. Steered/followUp messages are likewise fed to the LLM
  verbatim, never command-dispatched. `terminate: true` only ends the tool
  batch; it does not bridge to a command.
- There is no host-agnostic hook for a tool call to trigger a command. Real
  hosts can bridge it (e.g. `cate-plan-mode` records intent + the Cate UI button
  runs the follow-up command), but stock pi does not, and the self-looping use
  case has no human in the loop to type the command.

So fork is only reachable from `/neuralyzer` typed by a human — not from the
tool, which is the primary path. A fork-only design would break the loop;
a hybrid (command forks, tool wipes) would make the two triggers behave
differently and stop the closed-loop tests from mirroring the real tool path.

## Consequences

Context-wipe:

- (+) Works from the tool in stock pi, no host bridge.
- (+) Identical behavior for tool and command — tests mirror real usage.
- (+) Tokens sent to the model stay small (stripped before each call).
- (+) Survives restart/resume via the persisted marker.
- (−) Messages are **hidden, not deleted** — the session file retains the whole
  history and grows with every wipe; the cut scan is O(n) per LLM call. Fine for
  a handful of iterations, wasteful for very long-running loops.
- (−) Relies on re-send + content-match anchoring, which is more moving parts
  than a fork.

## Revisit when

Switch to fork (or a hybrid: command forks for a true physical wipe, tool keeps
context-wipe) if any of these land in pi:

- Tools or event handlers gain access to `fork()` / session mutation.
- A supported way for a tool to dispatch a command, or a tool-result directive
  to request a session operation.
- A standard host bridge from a tool call to a command.

Until then, context-wipe is the only mechanism that satisfies the LLM-triggered
requirement.

## References

- `core/extensions/types.d.ts` — `ExtensionCommandContext.fork`, `ExtensionContext`
- `core/extensions/wrapper.js:13` — extension tools wrapped with `runner.createContext()`
- `core/agent-session.js` — `sendUserMessage` → `prompt({ expandPromptTemplates: false })`
- `core/session-manager.js` — `appendCustomEntry` (persisted, not sent to the LLM)
