import { dce, pipeline, ordinary, repeat } from "./cases.mjs"
const live = repeat(
  80,
  (i) =>
    `export function select${i}({ a, nested: { b }, ...rest }, [first, ...tail]) { return [a,b,rest,first,tail]; }`,
)
const rest = repeat(
  40,
  (i) =>
    `const { omit${i}, keep${i}, ...rest${i} }=source; export const out${i}=rest${i}; export const drop${i}=DROP([omit${i},keep${i}]);`,
)
export default [
  dce("live-nonempty-patterns", live),
  dce("live-object-rest-exclusions", rest),
  dce(
    "empty-nested-pattern-cleanup",
    "const { nested: [value] }=source; export const answer=DROP(value);",
  ),
  dce("no-pattern-no-removal-control", ordinary(40)),
  pipeline("live-patterns-end-to-end", live),
]
