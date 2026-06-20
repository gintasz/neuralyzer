import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	// Inline @gintasz/neuralyzer-core so it never has to be published. Everything else
	// (typebox dep, pi-coding-agent peer) stays external.
	noExternal: ["@gintasz/neuralyzer-core"],
});
