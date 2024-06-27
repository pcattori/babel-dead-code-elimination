import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import dedent from "dedent"
import * as prettier from "prettier"

import { traverse } from "./babel-esm"
import deadCodeElimination from "./dead-code-elimination"
import findReferencedIdentifiers from "./find-referenced-identifiers"

async function format(source: string): Promise<string> {
  return prettier.format(source, { parser: "babel", semi: false })
}

let dce = async (source: string): Promise<string> => {
  let ast = parse(source, { sourceType: "module" })
  deadCodeElimination(ast)
  return format(generate(ast).code)
}

describe("import", () => {
  test("side-effect", async () => {
    let source = dedent`
      import "side-effect"
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import "side-effect"
      "
    `)
  })

  test("named", async () => {
    let source = dedent`
      import { a, _b } from "named"
      import { _c } from "named-unused"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import { a } from "named"
      console.log(a)
      "
    `)
  })

  test("default", async () => {
    let source = dedent`
      import a from "default-used"
      import _b from "default-unused"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import a from "default-used"
      console.log(a)
      "
    `)
  })

  test("namespace", async () => {
    let source = dedent`
      import * as a from "namespace-used"
      import * as _b from "namespace-unused"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import * as a from "namespace-used"
      console.log(a)
      "
    `)
  })
})

describe("function", () => {
  test("declaration", async () => {
    let source = dedent`
      export function a() {
        return
      }
      function _b() {
        return
      }
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "export function a() {
        return
      }
      "
    `)
  })

  test("expression", async () => {
    let source = dedent`
      export let a = function () {
        return
      }
      let _b = function () {
        return
      }
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "export let a = function () {
        return
      }
      "
    `)
  })

  test("arrow", async () => {
    let source = dedent`
      export let a = () => {
        return
      }
      let _b = () => {
        return
      }
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "export let a = () => {
        return
      }
      "
    `)
  })
})

describe("variable", () => {
  test("identifier", async () => {
    let source = dedent`
      let a = "a"
      let _b = "b"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let a = "a"
      console.log(a)
      "
    `)
  })

  test("array pattern", async () => {
    let source = dedent`
      let [a, _b] = c
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let [a] = c
      console.log(a)
      "
    `)
  })

  test("object pattern", async () => {
    let source = dedent`
      let {a, _b} = c
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let { a } = c
      console.log(a)
      "
    `)
  })
})

test("repeated elimination", async () => {
  let source = dedent`
    import { a } from "named"
    import b from "default"
    import * as c from "namespace"

    function d() {
      return [a, b, c]
    }

    let e = function () {
      return d()
    }

    let f = () => {
      return e()
    }

    let g = f()
    let [h] = g
    let { i } = g

    export let j = "j"
    console.log("k")
  `
  expect(await dce(source)).toMatchInlineSnapshot(`
    "export let j = "j"
    console.log("k")
    "
  `)
})

test("only eliminates newly unreferenced identifiers", async () => {
  let source = dedent`
    let alwaysUnreferenced = 1

    let newlyUnreferenced = 2
    export default newlyUnreferenced

    let alwaysReferenced = 3
    console.log(alwaysReferenced)
  `

  let ast = parse(source, { sourceType: "module" })
  let referenced = findReferencedIdentifiers(ast)
  traverse(ast, {
    ExportDefaultDeclaration(path) {
      path.remove()
    },
  })
  deadCodeElimination(ast, referenced)
  expect(await format(generate(ast).code)).toMatchInlineSnapshot(`
    "let alwaysUnreferenced = 1
    let alwaysReferenced = 3
    console.log(alwaysReferenced)
    "
  `)
})
