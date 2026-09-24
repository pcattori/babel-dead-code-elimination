import { runInNewContext } from "node:vm"
import { expect, test } from "vitest"
import generate from "@babel/generator"
import type { Visitor } from "@babel/traverse"

import { parse, traverse, t, type NodePath, type Babel } from "./babel-esm"
import {
  collectReferencedIdentifiers,
  deadCodeElimination,
  findReferencedIdentifiers,
} from "./index"

test.each([false, true])(
  "preserves eager declaration path identities with fresh scopes: %s",
  (scopeIsFresh) => {
    const ast = parse(
      `
      import defaultValue, { source as valueSource } from "source";
      import * as namespace from "namespace";
      var value = defaultValue;
      var value = valueSource;
      const { item: renamed, ...rest } = namespace;
      const [first, , ...tail] = rest.items;
      function left() { return right(); }
      function right() { return left(); }
      export function keep() {
        const value = renamed;
        const local = value;
        return [local, first, tail];
      }
      console.log(value, namespace);
    `,
      { sourceType: "module" },
    )
    traverse(ast, { Program() {} })
    const readReferences = collectReferencedIdentifiers(ast, {
      scopeIsFresh,
      visitor: {},
    })
    const collected = [...readReferences()]
    const eager = [...findReferencedIdentifiers(ast)]

    expect(collected.map((path) => path.node.name)).toEqual([
      "defaultValue",
      "valueSource",
      "namespace",
      "value",
      "value",
      "renamed",
      "rest",
      "first",
      "tail",
      "keep",
      "value",
      "local",
    ])
    expect(collected).toHaveLength(eager.length)
    for (let index = 0; index < eager.length; index++) {
      expect(collected[index]).toBe(eager[index])
    }
  },
)

test("merged read-only visitors observe the same enter, exit and alias events", () => {
  const ast = parse(
    `
    const value = 2;
    function outer() {
      const inner = () => value;
      return inner();
    }
    console.log(outer());
  `,
    { sourceType: "module" },
  )
  const observe = (events: Array<string>): Visitor => ({
    enter(path) {
      events.push(`enter:${path.node.type}:${path.node.start}`)
    },
    exit(path) {
      events.push(`exit:${path.node.type}:${path.node.start}`)
    },
    "Function|VariableDeclaration"(path) {
      events.push(`alias:${path.node.type}:${path.node.start}`)
    },
    ReferencedIdentifier(path) {
      events.push(`reference:${path.node.type}:${path.node.start}`)
    },
  })
  const expected: Array<string> = []
  traverse(ast, observe(expected))
  const actual: Array<string> = []
  const readReferences = collectReferencedIdentifiers(ast, {
    scopeIsFresh: true,
    visitor: observe(actual),
  })

  expect(actual).toEqual(expected)
  expect([...readReferences()].map((path) => path.node.name)).toEqual([
    "value",
    "outer",
    "inner",
  ])
})

test("default collection refreshes raw edits before the supplied visitor reads bindings", () => {
  const ast = parse("const value = 42", { sourceType: "module" })
  traverse(ast, { Program() {} })
  ast.program.body.push(
    t.exportNamedDeclaration(
      t.variableDeclaration("const", [
        t.variableDeclarator(t.identifier("answer"), t.identifier("value")),
      ]),
    ),
  )
  let sawAnswer = false
  const readReferences = collectReferencedIdentifiers(ast, {
    visitor: {
      Program(path) {
        sawAnswer = path.scope.getBinding("answer") !== undefined
      },
    },
  })

  expect(sawAnswer).toBe(true)
  expect([...readReferences()].map((path) => path.node.name)).toEqual([
    "value",
    "answer",
  ])
})

test("collected references preserve runtime behavior after a later rewrite and DCE", () => {
  const ast = parse(
    `
    function loadServerValue() { return serverRuntime(); }
    const serverValue = loadServerValue();
    const kept = 7;
    const sideEffect = record("application");
    function run() { return serverValue + kept; }
    globalThis.result = run();
  `,
    { sourceType: "script" },
  )
  let rewrite: NodePath<Babel.ReturnStatement> | undefined
  const readReferences = collectReferencedIdentifiers(ast, {
    visitor: {
      ReturnStatement(path) {
        const parent = path.getFunctionParent()
        if (parent?.isFunctionDeclaration() && parent.node.id?.name === "run") {
          rewrite = path
        }
      },
    },
  })
  const referenced = readReferences()
  expect(rewrite).toBeDefined()
  rewrite!.get("argument").replaceWith(t.identifier("kept"))
  deadCodeElimination(ast, referenced)

  const calls: Array<string> = []
  const result = runInNewContext(`${generate(ast).code}\nresult`, {
    record: (value: string) => calls.push(value),
    serverRuntime: () => {
      calls.push("server")
      return 100
    },
  })
  expect(result).toBe(7)
  expect(calls).toEqual(["application"])
})

test("reused visitors observe fresh bindings and all callbacks on every edited AST", () => {
  const bindings: Array<Babel.Node | undefined> = []
  const declarations: Array<Babel.VariableDeclarator> = []
  const events: Array<string> = []
  const visitor: Visitor = {
    enter(path) {
      if (path.isProgram()) {
        bindings.push(path.scope.getBinding("answer")?.path.node)
        events.push("enter")
      }
    },
    Program() {
      events.push("Program")
    },
    Referenced(path) {
      if (path.isIdentifier({ name: "value" })) {
        events.push("reference")
      }
    },
    exit(path) {
      if (path.isProgram()) {
        events.push("exit")
      }
    },
  }

  for (let index = 0; index < 3; index++) {
    const ast = parse(`const value = ${index}`, { sourceType: "module" })
    traverse(ast, { Program() {} })
    const declaration = t.variableDeclarator(
      t.identifier("answer"),
      t.identifier("value"),
    )
    declarations.push(declaration)
    ast.program.body.push(
      t.exportNamedDeclaration(t.variableDeclaration("const", [declaration])),
    )
    const readReferences = collectReferencedIdentifiers(ast, { visitor })
    expect([...readReferences()].map((path) => path.node.name)).toEqual([
      "value",
      "answer",
    ])
  }

  expect(bindings).toHaveLength(declarations.length)
  for (let index = 0; index < declarations.length; index++) {
    expect(bindings[index]).toBe(declarations[index])
  }
  expect(events).toEqual(
    Array.from({ length: 3 }, () => [
      "enter",
      "Program",
      "reference",
      "exit",
    ]).flat(),
  )
})
