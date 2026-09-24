import { pipeline, registry, repeat } from "./cases.mjs"
export default [
  {
    name: "dependency-registry-48",
    code: registry(48, 2),
    phase: "graph",
    iterations: 512,
  },
  {
    name: "wide-registry-512",
    code: registry(512, 1),
    phase: "graph",
    iterations: 128,
  },
  {
    name: "repeated-edges-256x4",
    code: registry(256, 4),
    phase: "graph",
    iterations: 128,
  },
  {
    name: "sparse-cycle-32",
    code: repeat(32, (i) => `function f${i}() { return f${(i + 1) % 32}(); }`),
    phase: "graph",
    iterations: 512,
  },
  {
    name: "externally-used-48",
    code: repeat(48, (i) => `const value${i} = ${i}; consume(value${i});`),
    phase: "graph",
    iterations: 512,
  },
  {
    name: "empty-bindings",
    code: "consume(42);",
    phase: "graph",
    iterations: 2048,
  },
  pipeline("registry-48-end-to-end", registry(48, 2), { candidates: "all" }),
]
