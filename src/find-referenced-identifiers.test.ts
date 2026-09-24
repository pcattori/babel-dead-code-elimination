import { expect, test } from "vitest"
import { parse } from "@babel/parser"

import findReferencedIdentifiers from "./find-referenced-identifiers"
import dedent from "dedent"
import { traverse, t } from "./babel-esm"

const findReferencedNames = (source: string): string[] => {
  let ast = parse(source, { sourceType: "module" })
  let referencedPaths = Array.from(findReferencedIdentifiers(ast))
  return referencedPaths.map((path) => path.node.name)
}

test("import:named", () => {
  let source = dedent`
    import { referenced, unreferenced } from "pkg"
    ref(referenced)
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("import:default", () => {
  let source = dedent`
    import referenced from "referenced-pkg"
    import unreferenced from "unreferenced-pkg"
    ref(referenced)
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("import:namespace", () => {
  let source = dedent`
    import * as referenced from "referenced-pkg"
    import * as unreferenced from "unreferenced-pkg"
    ref(referenced)
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("function:declaration", () => {
  let source = dedent`
    function referenced() {}
    ref(referenced)

    function unreferenced() {}
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("function:expression", () => {
  let source = dedent`
    let referenced = function () {}
    ref(referenced)

    let unreferened = function () {}
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("function:arrow", () => {
  let source = dedent`
    let referenced = () => {}
    ref(referenced)

    let unreferened = () => {}
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("variable:identifier", () => {
  let source = dedent`
    let referenced = 1
    ref(referenced)

    let unreferenced = 2
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("variable:object pattern", () => {
  let source = dedent`
    let { referenced, unreferenced } = thing
    ref(referenced)
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("variable:array pattern", () => {
  let source = dedent`
    let [ referenced, unreferenced ] = thing
    ref(referenced)
  `
  expect(findReferencedNames(source)).toStrictEqual(["referenced"])
})

test("circular references", () => {
  let source = dedent`
    function y () {
      return x()
    }
    function x() { return y() }
  `
  expect(findReferencedNames(source)).toStrictEqual([])
})

test("fresh scopes preserve nested and duplicate declaration identities", () => {
  const ast = parse(
    `
    var value = 1;
    var value = 2;
    export function keep() {
      const local = value;
      return local;
    }
  `,
    { sourceType: "module" },
  )
  traverse(ast, { Program() {} })
  const fresh = findReferencedIdentifiers(ast, { scopeIsFresh: true })
  const refreshed = findReferencedIdentifiers(ast)
  expect([...fresh]).toEqual([...refreshed])
  expect([...fresh].map((path) => path.node.name)).toEqual([
    "value",
    "value",
    "keep",
    "local",
  ])
})

test("default collection refreshes references introduced by AST plugins", () => {
  const ast = parse("const value = 42", { sourceType: "module" })
  traverse(ast, { Program() {} })
  ast.program.body.push(
    t.exportNamedDeclaration(
      t.variableDeclaration("const", [
        t.variableDeclarator(t.identifier("answer"), t.identifier("value")),
      ]),
    ),
  )
  expect(
    [...findReferencedIdentifiers(ast)].map((path) => path.node.name),
  ).toEqual(["value", "answer"])
})
