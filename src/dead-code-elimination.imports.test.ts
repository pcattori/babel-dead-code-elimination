import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import deadCodeElimination from "./dead-code-elimination"
import findReferencedIdentifiers from "./find-referenced-identifiers"
import { t, traverse } from "./babel-esm"

test("transitive cleanup preserves original side-effect imports", () => {
  const ast = parse(
    `
    import "side-effect";
    import { value } from "dependency";
    const first=value;
    const second=first;
    export const answer=DROP(second);
  `,
    { sourceType: "module" },
  )
  const candidates = findReferencedIdentifiers(ast)
  traverse(ast, {
    CallExpression(path) {
      if (t.isIdentifier(path.node.callee, { name: "DROP" })) {
        path.replaceWith(t.numericLiteral(42))
      }
    },
  })
  deadCodeElimination(ast, candidates)
  expect(
    ast.program.body.flatMap((node) =>
      t.isImportDeclaration(node) ? [node.source.value] : [],
    ),
  ).toEqual(["side-effect"])
  const output = generate(ast)
    .code.replace(/^import[^;]+;/gm, "")
    .replace(/\bexport /g, "")
  expect(runInNewContext(`${output}\nanswer`)).toBe(42)
})
