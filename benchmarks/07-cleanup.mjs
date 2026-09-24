import { dce, pipeline, ordinary, repeat } from "./cases.mjs"
const variables = `${repeat(128, (i) => `const value${i}=${i};`)}\nexport const answer=DROP([${Array.from({ length: 128 }, (_, i) => `value${i}`).join(",")}]);`
const functions = `${repeat(48, (i) => `function value${i}() { return ${i}; }`)}\nexport const answer=DROP([${Array.from({ length: 48 }, (_, i) => `value${i}`).join(",")}]);`
export default [
  dce("candidate-filtered-128-variables", variables),
  dce("candidate-filtered-48-functions", functions),
  dce("no-removal-control", ordinary(40)),
  pipeline("48-functions-end-to-end", functions),
]
