



<div align="center">

<a href="https://www.youtube.com/watch?v=QGplYmKxcGM"><img src="https://raw.githubusercontent.com/gintasz/neuralyzer/main/docs/readme_hero.jpg" alt="Neuralyzer — give AI agent tool to wipe its own session context (Men In Black style)" width="640" /></a>

# 🕶️✨ Neuralyzer — make Ralph loops easier

</div>

Watch the first minute of [this video](https://www.youtube.com/watch?v=QGplYmKxcGM) as an introduction. This extension adds 1 tool for AI agent harnesses to call, named `neuralyzer` (no arguments). When this tool is called, all of the user & assistant messages in the session context are wiped and a copy of first message is sent again. Example:

```
USER: Hi, how are you?
ASSISTANT: Good. How can I help?
USER: Call neuralyzer tool

🕶️✨ Neuralyzer flashed.

USER: Hi, how are you? [sent automatically]
ASSISTANT: Ready to help!
USER: Was neuralyzer tool used in this conversation?
ASSISTANT: No, never used.
```

## What's the point?

Easier loop engineering. Traditional Ralph loop is basically running this command in your command line: `while :; do cat PROMPT.md | pi -p ; done`, but you have to bother saving prompt to file, checking loop exit conditions, etc, or adapting your workflow to what a third-party tool/extension demands. With this tool, you can just send a message to the agent with control flow as such, example:

```
Check if @john has submitted a GitHub PR in this repo fixing authentication bug.
If yes -> add GitHub comment to that PR saying "Thank you".
If no -> wait 5 min and call neuralyzer.
```

## Better than /loop?

`/loop` keeps adding to your session's context window, causing context rot and increased session continuation cost due to more tokens being in it, whereas neuralyzer gives the agent a fresh start and makes a loop setup super easy.

## Install

Pick your harness:

<details open>
<summary><b>pi</b></summary>

```bash
pi install npm:@gintasz/pi-neuralyzer
```

</details>

> Don't see your harness? Adding one is the most welcome kind of PR — see [CONTRIBUTING](https://github.com/gintasz/neuralyzer/blob/main/CONTRIBUTING.md).