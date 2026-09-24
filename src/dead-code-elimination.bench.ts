import { runInNewContext } from "node:vm"
import { bench, describe, expect } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import { t, traverse } from "./babel-esm"
import deadCodeElimination from "./dead-code-elimination"
import findReferencedIdentifiers from "./find-referenced-identifiers"

const scenarios = [
  {
    name: "large module with a stripped schema",
    code: [
      "const schema = (value) => value.trim(); export const answer = DROP(schema);",
      ...Array.from(
        { length: 200 },
        (_, i) => `export function ordinary${i}(value) {
        const data = { value: value.trim(), count: ${i} };
        return { label: data.value.toUpperCase(), score: data.count * 2 };
      }`,
      ),
    ].join("\n"),
    expression: "[answer, ordinary199(' value ').score]",
    expected: [0, 398],
  },
  {
    name: "cascading schema dependencies",
    code: [
      "const value0 = () => 42;",
      ...Array.from(
        { length: 80 },
        (_, i) => `const value${i + 1} = value${i};`,
      ),
      "export const answer = DROP(value80);",
    ].join("\n"),
    expression: "answer",
    expected: 0,
  },
]

function transform(code: string) {
  const ast = parse(code, { sourceType: "module" })
  const referenced = findReferencedIdentifiers(ast)
  traverse(ast, {
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee, { name: "DROP" })) {
        path.replaceWith(t.numericLiteral(0))
      }
    },
  })
  deadCodeElimination(ast, referenced)
  return generate(ast).code
}

describe("dead-code elimination pipeline", () => {
  for (const scenario of scenarios) {
    const output = transform(scenario.code).replace(/\bexport /g, "")
    expect(runInNewContext(`${output}\n${scenario.expression}`)).toEqual(
      scenario.expected,
    )
    bench(
      scenario.name,
      () => {
        transform(scenario.code)
      },
      {
        time: 1000,
        warmupTime: 200,
        throws: true,
      },
    )
  }
})
