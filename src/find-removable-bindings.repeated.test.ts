import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"
import generate from "@babel/generator"
import { parse } from "./babel-esm"
import { deadCodeElimination, findReferencedIdentifiers } from "./index"

test("repeated interleaved dependencies preserve reachable recursion and eliminate a closed cycle", () => {
  const ast = parse(
    `
    const offset = 3;
    function left(n) {
      return n ? right(n - 1) + offset + right(n - 1) : offset;
    }
    function deadA() { return deadB() + deadC() + deadB() + deadD(); }
    function deadB() { return deadA() + deadD() + deadC() + deadA(); }
    function right(n) {
      return n ? left(n - 1) + offset + left(n - 1) : offset;
    }
    function deadC() { return deadD() + deadA() + deadB() + deadD(); }
    function deadD() { return deadA() + deadB() + deadA() + deadC(); }
    export function keep() { return left(2) + right(1) + left(0); }
  `,
    { sourceType: "module" },
  )
  expect(
    [...findReferencedIdentifiers(ast)].map((path) => path.node.name),
  ).toEqual(["offset", "left", "right", "keep"])

  deadCodeElimination(ast)
  const output = generate(ast).code.replace(/\bexport /g, "")
  expect(
    runInNewContext(
      `${output}\n[keep(), typeof deadA, typeof deadB, typeof deadC, typeof deadD]`,
    ),
  ).toEqual([33, "undefined", "undefined", "undefined", "undefined"])
})
