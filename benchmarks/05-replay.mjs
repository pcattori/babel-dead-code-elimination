import { dce, pipeline, ordinary, schema, chain, repeat } from "./cases.mjs"
const nested = repeat(
  24,
  (i) =>
    `const { items: [value${i} = (() => { const inner${i}=42; return inner${i}; })()] }=source; export const answer${i}=DROP(value${i});`,
)
export default [
  dce("one-dead-schema-80-live-functions", schema(80)),
  dce("24-link-cascade", chain(24)),
  dce("nested-pattern-removed-subtrees", nested),
  dce("no-removal-control", ordinary(80)),
  dce("empty-array-parameter-control", "export const keep = ([[]]) => 42;", {
    candidates: "all",
  }),
  dce(
    "tiny-removal-control",
    "const schema=value=>value; export const answer=DROP(schema);",
  ),
  pipeline("schema-80-end-to-end", schema(80)),
  pipeline("24-link-cascade-end-to-end", chain(24)),
]
