import { pipeline, schema, unrelated } from "./cases.mjs"
export default [
  {
    name: "accepted-schema-16",
    code: schema(16),
    phase: "analysis",
    iterations: 32,
  },
  {
    name: "accepted-schema-80",
    code: schema(80),
    phase: "analysis",
    iterations: 16,
  },
  {
    name: "discarded-validator-calls-200",
    code: unrelated(200),
    phase: "analysis",
    iterations: 16,
  },
  {
    name: "discarded-validator-references-200",
    code: unrelated(200).replace(/form\.validator\(\d+\)/g, "form.validator"),
    phase: "analysis",
    iterations: 16,
  },
  {
    name: "tiny-accepted",
    code: "const value=42; export const answer=DROP(value);",
    phase: "analysis",
    iterations: 128,
  },
  {
    name: "default-collector-refresh",
    code: schema(16),
    phase: "analysis",
    defaultRefresh: true,
    iterations: 32,
  },
  {
    name: "default-api-control",
    code: schema(40),
    phase: "references",
    iterations: 16,
  },
  pipeline("schema-80-end-to-end", schema(80), { sharedTraversal: true }),
  pipeline("discarded-200-end-to-end", unrelated(200), {
    sharedTraversal: true,
  }),
]
