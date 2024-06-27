import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import dedent from "dedent"
import * as prettier from "prettier"

import removeUnusedVariables from "./remove-unused-variables"

let transform = async (source: string): Promise<string> => {
  let ast = parse(source, { sourceType: "module" })
  removeUnusedVariables(ast)
  return prettier.format(generate(ast).code, { parser: "babel", semi: false })
}

describe("VariableDeclarator", () => {
  test("Identifier", async () => {
    let source = dedent`
      let _x = 1
      let x = 1
      ref(x)
    `
    expect(await transform(source)).toMatchInlineSnapshot(`
      "let x = 1
      ref(x)
      "
    `)
  })

  describe("ObjectPattern", () => {
    test("within VariableDeclarator", async () => {
      let source = dedent`
        let { _a, a } = x
        ref(a)

        let {..._rest} = x
        let {...rest} = x
        ref(rest)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let { a } = x
        ref(a)
        let { ...rest } = x
        ref(rest)
        "
      `)
    })

    test("within ObjectProperty", async () => {
      let source = dedent`
        let { a: { _aa, aa, ..._rest } } = x
        ref(aa)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let {
          a: { aa },
        } = x
        ref(aa)
        "
      `)
    })

    test("within ArrayPattern", async () => {
      let source = dedent`
        let { a: [{ _aa, aa, ..._rest }] } = x
        ref(aa)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let {
          a: [{ aa }],
        } = x
        ref(aa)
        "
      `)
    })

    describe("within AssignmentPattern", () => {
      test("within ObjectProperty", async () => {
        let source = dedent`
          let { a: { _aa, aa, ..._rest }={ aa: 1 } } = x
          ref(aa)
        `
        expect(await transform(source)).toMatchInlineSnapshot(`
          "let {
            a: { aa } = {
              aa: 1,
            },
          } = x
          ref(aa)
          "
        `)
      })

      test("within ArrayPattern", async () => {
        let source = dedent`
          let { a: [{ _aa, aa, ...rest }={ aa: 1 }] } = x
          ref(aa)
        `
        expect(await transform(source)).toMatchInlineSnapshot(`
          "let {
            a: [
              { aa } = {
                aa: 1,
              },
            ],
          } = x
          ref(aa)
          "
        `)
      })
    })

    test("within RestElement", async () => {
      let source = dedent`
        let [...{ _a, a, ..._rest }] = x
        ref(a)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let [...{ a }] = x
        ref(a)
        "
      `)
    })

    test("unzips if all variables are unused", async () => {
      let source = dedent`
        let {
          _a, // Identifier
          _b: {_bb, ..._brest}, // within ObjectProperty
          _c: [{_cc, ..._crest}], // within ArrayPattern
          _d: {_dd, ..._drest} = {}, // within AssignmentPattern within ObjectProperty
          _e: [{_ee, ..._erest}={}], // within AssignmentPattern within ArrayPattern
          _f: [...{_ff, ..._frest}], // within RestElement
          ..._g // RestElement
        } = _x
      `
      expect(await transform(source)).toMatchInlineSnapshot(`""`)
    })
  })

  describe("ArrayPattern", () => {
    test("within VariableDeclarator", async () => {
      let source = dedent`
        let [ _a0, a1, _a2, a3, _a4 ] = x
        ref(a1, a3)

        let [..._rest] = x
        let [...rest] = x
        ref(rest)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let [, a1, , a3, ,] = x
        ref(a1, a3)
        let [...rest] = x
        ref(rest)
        "
      `)
    })

    test("within ObjectProperty", async () => {
      let source = dedent`
        let { a: [ _aa, aa, ..._rest ] } = x
        ref(aa)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let {
          a: [, aa],
        } = x
        ref(aa)
        "
      `)
    })

    test("within ArrayPattern", async () => {
      let source = dedent`
        let [[ _aa, aa, ..._rest ]] = x
        ref(aa)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let [[, aa]] = x
        ref(aa)
        "
      `)
    })

    describe("within AssignmentPattern", () => {
      test("within ObjectProperty", async () => {
        let source = dedent`
          let { a: { _aa, aa, ..._rest }={ aa: 1 } } = x
          ref(aa)
        `
        expect(await transform(source)).toMatchInlineSnapshot(`
          "let {
            a: { aa } = {
              aa: 1,
            },
          } = x
          ref(aa)
          "
        `)
      })

      test("within ArrayPattern", async () => {
        let source = dedent`
          let [{ _a, a, ...rest }={ a: 1 }] = x
          ref(a)
        `
        expect(await transform(source)).toMatchInlineSnapshot(`
          "let [
            { a } = {
              a: 1,
            },
          ] = x
          ref(a)
          "
        `)
      })
    })

    test("within RestElement", async () => {
      let source = dedent`
        let [...[ _a, a, ..._rest ]] = x
        ref(a)
      `
      expect(await transform(source)).toMatchInlineSnapshot(`
        "let [...[, a]] = x
        ref(a)
        "
      `)
    })

    test("unzips if all variables are unused", async () => {
      let source = dedent`
        let [
          _a, // Identifier
          {_b, ..._brest}, // within ObjectProperty
          [{_c, ..._crest}], // within ArrayPattern
          {_d, ..._drest} = {}, // within AssignmentPattern within ObjectProperty
          [{_e, ..._erest}={}], // within AssignmentPattern within ArrayPattern
          [...{_f, ..._frest}], // within RestElement
          ..._g // RestElement
        ] = _x
      `
      expect(await transform(source)).toMatchInlineSnapshot(`""`)
    })
  })
})
