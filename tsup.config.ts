import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  shims: true,
  dts: true,
  clean: true,
})
