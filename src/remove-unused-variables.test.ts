import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import dedent from "dedent"

import removeUnusedVariables from "./remove-unused-variables"

let transform = (source: string): string => {
  let ast = parse(source, { sourceType: "module" })
  removeUnusedVariables(ast)
  return generate(ast).code
}

describe("variable declarator", () => {
  test("identifier", async () => {
    let source = dedent`
      let _x = 1
      export let x = 1
    `
    expect(transform(source)).toMatchInlineSnapshot(`"export let x = 1;"`)
  })

  test("object pattern", async () => {
    let source = dedent`
      let _input = { _x: 1 }
      let { _x, ..._restx } = _input

      let input = { _a: 1, a: 1, _b: { _bb: 1 }, b: { bb: 1 }, c: { _cc: 1, cc: 1 } }
      let { _a, a, _b: { _bb }, b: { bb }, c: { _cc, cc }, ...rest } = input
      console.log(a, bb, cc, rest)
    `
    expect(transform(source)).toMatchInlineSnapshot(`
      "let input = {
        _a: 1,
        a: 1,
        _b: {
          _bb: 1
        },
        b: {
          bb: 1
        },
        c: {
          _cc: 1,
          cc: 1
        }
      };
      let {
        a,
        b: {
          bb
        },
        c: {
          cc
        },
        ...rest
      } = input;
      console.log(a, bb, cc, rest);"
    `)
  })
})
