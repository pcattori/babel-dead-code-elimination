import { ordinary, pipeline, schema } from "./cases.mjs"
export default [
  {
    name: "typical-module",
    code: schema(16),
    phase: "references",
    optIn: true,
    iterations: 32,
  },
  {
    name: "many-nested-scopes",
    code: schema(128),
    phase: "references",
    optIn: true,
    iterations: 16,
  },
  {
    name: "tiny-module",
    code: "const value=42; export const answer=value;",
    phase: "references",
    optIn: true,
    iterations: 128,
  },
  {
    name: "default-api-control",
    code: ordinary(40),
    phase: "references",
    iterations: 16,
  },
  pipeline("schema-40-end-to-end", schema(40), { optIn: true }),
]
