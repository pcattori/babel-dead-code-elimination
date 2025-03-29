import { expect, test } from "vitest"
import { parse } from "@babel/parser"

import findReferencedIdentifiers from "./find-referenced-identifiers"
import dedent from "dedent"

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
