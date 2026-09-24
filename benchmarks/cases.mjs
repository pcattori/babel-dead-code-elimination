export const repeat = (count, line) =>
  Array.from({ length: count }, (_, i) => line(i)).join("\n")
export const ordinary = (count) =>
  repeat(
    count,
    (i) =>
      `export function ordinary${i}(value) { const data = { value: value.trim(), count: ${i} }; return { label: data.value.toUpperCase(), score: data.count * 2 }; }`,
  )
export const schema = (count) =>
  `const schema = value => value.trim(); export const answer = DROP(schema);\n${ordinary(count)}`
export const chain = (count) =>
  `const value0 = () => 42;\n${repeat(count, (i) => `const value${i + 1} = value${i};`)}\nexport const answer = DROP(value${count});`
export const registry = (count, references) =>
  `${repeat(count, (i) => `const value${i} = ${i};`)}\nexport function collect() { return [${Array.from({ length: count }, (_, i) => Array(references).fill(`value${i}`).join(",")).join(",")}]; }`
export const unrelated = (count, property = "validator") =>
  `const form = { ${property}: value => value };\n${repeat(count, (i) => `export const result${i} = form.${property}(${i});`)}`
export const dce = (name, code, extra = {}) => ({
  name,
  code,
  phase: "dce",
  iterations: 16,
  ...extra,
})
export const pipeline = (name, code, extra = {}) => ({
  name,
  code,
  phase: "pipeline",
  iterations: 16,
  ...extra,
})
