import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "node22",
	external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
	noExternal: ["@gintasz/neuralyzer-core"],
});
