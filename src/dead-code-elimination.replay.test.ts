import { runInNewContext } from "node:vm"
import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import { t } from "./babel-esm"
import deadCodeElimination from "./dead-code-elimination"

const fixtures = [
  {
    name: "nested array parameter cleanup preserves surviving argument positions",
    code: "export const keep = ([[], answer]) => answer",
    expression: "keep([[], 42])",
    expected: 42,
    emptyCandidates: true,
  },
  {
    name: "nested object parameter cleanup leaves the function callable",
    code: "export const keep = ({ discarded: {}, answer }) => answer",
    expression: "keep({ discarded: {}, answer: 42 })",
    expected: 42,
  },
  {
    name: "cascading declarations and removed function descendants",
    code: `const input=9;
      function discarded() { const [value]=[input]; return value; }
      const alias=discarded;
      export function keep() { return 42; }`,
    expression: "keep()",
    expected: 42,
  },
  {
    name: "nested array holes preserve surviving element positions",
    code: `export function keep() {
      const [used, [discarded], last]=[40,[9],2];
      const alias=discarded;
      return used+last;
    }`,
    expression: "keep()",
    expected: 42,
    declarations: ["[used,, last]"],
  },
  {
    name: "nested object patterns become empty after child cleanup",
    code: `export function keep() {
      const {used, nested:{discarded}}={used:42,nested:{discarded:9}};
      const alias=discarded;
      return used;
    }`,
    expression: "keep()",
    expected: 42,
    declarations: ["{ used }"],
  },
  {
    name: "object rest preserves excluded keys across iterations",
    code: `export function keep() {
      const {omitted,...rest}={omitted:9,answer:42};
      const alias=omitted;
      return rest;
    }`,
    expression: "JSON.stringify(keep())",
    expected: '{"answer":42}',
  },
  {
    name: "empty nested patterns with an explicit empty candidate set",
    code: `export function keep() {
      const {nested:{}}={nested:{}};
      const [[]]=[[]];
      return 42;
    }`,
    expression: "keep()",
    expected: 42,
    emptyCandidates: true,
  },
  {
    name: "retained destructuring parameters keep their runtime validation",
    code: "export const keep = ({}, []) => 42",
    expression:
      "[keep({}, []), (() => { try { keep(null, []); return false } catch { return true } })()]",
    expected: [42, true],
  },
  {
    name: "loop iterator bindings survive repeated cleanup",
    code: `const value=9; const alias=value;
      export function keep() {
        let result=0;
        for (const value of [20,22]) { result+=value; }
        return result;
      }`,
    expression: "keep()",
    expected: 42,
  },
  {
    name: "closed cycles and their dependencies leave retained code usable",
    code: `const value=9;
      function a() { return b()+value; }
      function b() { return a(); }
      export function keep() { return 42; }`,
    expression: "keep()",
    expected: 42,
  },
]

describe("declaration replay", () => {
  test.each(fixtures)(
    "$name",
    ({ code, expression, expected, emptyCandidates, declarations }) => {
      const ast = parse(code, { sourceType: "module" })
      deadCodeElimination(ast, emptyCandidates ? new Set() : undefined)
      const output = generate(ast).code.replace(/\bexport /g, "")
      expect(runInNewContext(`${output}\n${expression}`)).toEqual(expected)
      if (declarations) {
        const ids: string[] = []
        t.traverseFast(ast, (node) => {
          if (t.isVariableDeclarator(node)) {
            ids.push(generate(node.id, { compact: true }).code)
          }
        })
        expect(ids).toEqual(declarations.map((id) => id.replace(/\s+/g, "")))
      }
    },
  )
})
