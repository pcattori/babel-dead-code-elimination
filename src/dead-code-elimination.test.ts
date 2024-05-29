import { expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import dedent from "dedent"

import deadCodeElimination from "./dead-code-elimination"

let dce = (source: string): string => {
  let ast = parse(source, { sourceType: "module" })
  deadCodeElimination(ast)
  return generate(ast).code
}

test("import:side-effect", () => {
  let source = dedent`
    import "side-effect"
  `
  let expected = dedent`
    import "side-effect";
  `
  expect(dce(source)).toBe(expected)
})

test("import:named", () => {
  let source = dedent`
    import { a, _b } from "named"
    import { _c } from "named-unused"
    console.log(a)
  `
  let expected = dedent`
    import { a } from "named";
    console.log(a);
  `
  expect(dce(source)).toBe(expected)
})

test("import:default", () => {
  let source = dedent`
    import a from "default-used"
    import _b from "default-unused"
    console.log(a)
  `
  let expected = dedent`
    import a from "default-used";
    console.log(a);
  `
  expect(dce(source)).toBe(expected)
})

test("import:namespace", () => {
  let source = dedent`
    import * as a from "namespace-used"
    import * as _b from "namespace-unused"
    console.log(a)
  `
  let expected = dedent`
    import * as a from "namespace-used";
    console.log(a);
  `
  expect(dce(source)).toBe(expected)
})

test("function:declaration", () => {
  let source = dedent`
    export function a() {
      return
    }
    function _b() {
      return
    }
  `
  let expected = dedent`
    export function a() {
      return;
    }
  `
  expect(dce(source)).toBe(expected)
})

test("function:expression", () => {
  let source = dedent`
    export let a = function () {
      return
    }
    let _b = function () {
      return
    }
  `
  let expected = dedent`
    export let a = function () {
      return;
    };
  `
  expect(dce(source)).toBe(expected)
})

test("function:arrow", () => {
  let source = dedent`
    export let a = () => {
      return
    }
    let _b = () => {
      return
    }
  `
  let expected = dedent`
    export let a = () => {
      return;
    };
  `
  expect(dce(source)).toBe(expected)
})

test("variable:identifier", () => {
  let source = dedent`
    let a = "a"
    let _b = "b"
    console.log(a)
  `
  let expected = dedent`
    let a = "a";
    console.log(a);
  `
  expect(dce(source)).toBe(expected)
})

test("variable:array pattern", () => {
  let source = dedent`
    let [a, _b] = c
    console.log(a)
  `
  let expected = dedent`
    let [a] = c;
    console.log(a);
  `
  expect(dce(source)).toBe(expected)
})

test("variable:object pattern", () => {
  let source = dedent`
    let {a, _b} = c
    console.log(a)
  `
  let expected = dedent`
    let {
      a
    } = c;
    console.log(a);
  `
  expect(dce(source)).toBe(expected)
})

test("repeated elimination", () => {
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
  let expected = dedent`
    export let j = "j";
    console.log("k");
  `
  expect(dce(source)).toBe(expected)
})
