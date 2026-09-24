import { runInNewContext } from "node:vm"
import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import ts from "dedent"

import { traverse, t, type Babel, type NodePath } from "./babel-esm"
import { deadCodeElimination, findReferencedIdentifiers } from "./index"

// Regression tests for elimination defects that could leave dangling
// references, change semantics, crash, or keep unused code.

type Options = {
  /** Remove these exported declarations before DCE, like React Router's removeExports. */
  strip?: string[]
  /** Candidates: collected before the transform ("references"), none, or custom. */
  candidates?:
    | "references"
    | "none"
    | ((ast: Babel.File) => Set<NodePath<Babel.Identifier>>)
  typescript?: boolean
}

let parseModule = (code: string, typescript = false) =>
  parse(code, {
    sourceType: "module",
    plugins: typescript ? ["typescript", "jsx"] : [],
  })

let stripExports = (ast: Babel.File, names: string[]) => {
  traverse(ast, {
    ExportNamedDeclaration(path) {
      let declaration = path.node.declaration
      if (t.isFunctionDeclaration(declaration)) {
        if (names.includes(declaration.id!.name)) path.remove()
        return
      }
      if (
        t.isVariableDeclaration(declaration) &&
        declaration.declarations.every(
          (d) => t.isIdentifier(d.id) && names.includes(d.id.name),
        )
      ) {
        path.remove()
      }
    },
  })
}

let transform = (
  code: string,
  { strip = [], candidates = "references", typescript }: Options = {},
): string => {
  let ast = parseModule(code, typescript)
  let referenced =
    candidates === "references"
      ? findReferencedIdentifiers(ast)
      : candidates === "none"
        ? undefined
        : candidates(ast)
  if (strip.length > 0) stripExports(ast, strip)
  deadCodeElimination(ast, referenced)
  return generate(ast).code
}

let freeVariables = (code: string, typescript = false): string[] => {
  let names: string[] = []
  traverse(parseModule(code, typescript), {
    Program(path) {
      names = Object.keys(path.scope.globals)
      path.stop()
    },
  })
  return names
}

/** Free variables of the output that were declared in the input: dangling references. */
let danglingReferences = (input: string, output: string): string[] => {
  let before = new Set(freeVariables(input))
  return freeVariables(output).filter((name) => !before.has(name))
}

let evaluate = (code: string, expression: string): unknown =>
  runInNewContext(`${code.replace(/\bexport (default )?/g, "")}\n${expression}`)

let unchanged = (code: string, typescript = false) =>
  generate(parseModule(code, typescript)).code

describe("dangling references", () => {
  test("keeps an initializer that a surviving sibling binding still needs", () => {
    let source = ts`
      function createStore() {
        return { store: new Map(), invalidate: () => cache.clear() }
      }
      const { store, cache } = createStore()
      export function loader() { return cache }
      export default function Component() { return store.size }
    `
    let output = transform(source, { strip: ["loader"] })
    expect(danglingReferences(source, output)).toEqual([])
  })

  test("keeps an initializer without candidates", () => {
    let source = ts`
      const { a, b } = X()
      function X() { return { a: 1, b: () => b } }
      export { a }
    `
    let output = transform(source, { candidates: "none" })
    expect(danglingReferences(source, output)).toEqual([])
  })

  test.each(["references", "none"] as const)(
    "keeps a function referenced by a class that DCE keeps (candidates: %s)",
    (candidates) => {
      let source = ts`
        import { z } from "zod"
        function buildSchema() { return z.custom((v) => v instanceof Model) }
        class Model { static schema = buildSchema() }
        export function loader() { return Model.schema }
        export default function Component() { return 1 }
      `
      let output = transform(source, { strip: ["loader"], candidates })
      expect(danglingReferences(source, output)).toEqual([])
    },
  )

  test("keeps a candidate that a kept non-candidate references", () => {
    let source = ts`
      function makeRegistry() { return { get: () => registry } }
      const registry = makeRegistry()
      export const x = 1
    `
    let output = transform(source, {
      candidates: (ast) => {
        let candidates = new Set<NodePath<Babel.Identifier>>()
        traverse(ast, {
          FunctionDeclaration(path) {
            candidates.add(path.get("id") as NodePath<Babel.Identifier>)
          },
        })
        return candidates
      },
    })
    expect(danglingReferences(source, output)).toEqual([])
  })

  test.each([
    ["3 or fewer candidates", "", ""],
    [
      "Tarjan path",
      "function h1() { return 1 }\nfunction h2() { return 2 }\nfunction h3() { return 3 }",
      "h1(), h2(), h3(), ",
    ],
  ])(
    "keeps a self-recursive function that a surviving declaration calls (%s)",
    (_, helpers, helperCalls) => {
      let source = ts`
        ${helpers}
        const config = { children: [] }
        function walk(node) { return node.children ? node.children.map(walk) : node }
        const tree = walk(config)
        export function loader() { return [${helperCalls}walk(db)] }
        export default function Component() { return 1 }
      `
      let output = transform(source, { strip: ["loader"] })
      expect(danglingReferences(source, output)).toEqual([])
    },
  )

  test("removing a shadowing local keeps the module-level declaration", () => {
    let source = ts`
      export default function Page() {
        const config = { title: "unused" }
        return render()
      }
      const config = { title: "Hello" }
      function render() { return config.title }
    `
    let output = transform(source, { candidates: "none" })
    expect(danglingReferences(source, output)).toEqual([])
  })

  test("removing a for-loop binding keeps a same-named export", () => {
    let source = ts`
      for (let a = 0; ; ) { break }
      export const a = 1
    `
    let output = transform(source, { candidates: "none" })
    expect(output).toContain("export const a = 1")
  })

  test("a parameter named like its function does not hide the function", () => {
    let source = ts`
      export default function Page() { return label("x") }
      function label(text, label) { return "[" + text + "]" }
    `
    let output = transform(source, { candidates: "none" })
    expect(danglingReferences(source, output)).toEqual([])
  })
})

describe("changed semantics", () => {
  test.each([
    [
      "defaulted sibling",
      ts`
        export function Button(props) {
          const { variant = "primary", ...rest } = props
          return rest
        }
      `,
      `JSON.stringify(Button({ variant: "x", id: 1 }))`,
      `{"id":1}`,
    ],
    [
      "nested pattern sibling",
      ts`
        export function Button(props) {
          const { style: { color }, ...rest } = props
          return rest
        }
      `,
      `JSON.stringify(Button({ style: { color: "red" }, id: 1 }))`,
      `{"id":1}`,
    ],
    [
      "removable cycle through a default",
      ts`
        const obj = { a: 1, b: 2 }
        const { a = f(), ...rest } = obj
        function f() { return a }
        export const out = rest
      `,
      `JSON.stringify(out)`,
      `{"b":2}`,
    ],
  ])(
    "keeps object rest siblings that filter the rest object (%s)",
    (_, source, expression, expected) => {
      expect(evaluate(source, expression)).toBe(expected)
      let output = transform(source, { candidates: "none" })
      expect(evaluate(output, expression)).toBe(expected)
    },
  )

  test("keeps nested empty parameter patterns that validate arguments", () => {
    let source = "export const keep = ([[]]) => 42"
    let output = transform(source, { candidates: () => new Set() })
    expect(output).toBe(unchanged(source))
  })
})

describe("crashes", () => {
  test.each([
    [
      "type P = { a: number }\nexport const f: ({}: P) => number = () => 1",
      true,
    ],
    ["export const g = (cb: ({}: P) => void) => cb", true],
    ["export const f = ({} = {}) => 1", false],
    ["export const f = () => {\n  try {\n    g()\n  } catch ({}) {}\n}", false],
  ])(
    "leaves empty patterns outside declarator ids alone: %s",
    (source, typescript) => {
      let output = transform(source, { candidates: "none", typescript })
      expect(output).toBe(unchanged(source, typescript))
    },
  )

  test.each([
    "export function f(arr) {\n  for (const {} of arr) {}\n  return 1\n}",
    "export function f(o) {\n  for (const [] in o) {}\n  return 1\n}",
  ])("leaves empty loop-head patterns alone: %s", (source) => {
    let output = transform(source, { candidates: "none" })
    expect(output).toBe(unchanged(source))
  })

  // Large enough to overflow the recursive SCC search in Vitest worker threads.
  test("analyzes a long reference cycle without exhausting the stack", () => {
    let count = 40_000
    let source = Array.from(
      { length: count },
      (_, i) => `function f${i}() { return f${(i + 1) % count}() }`,
    ).join("\n")
    expect(findReferencedIdentifiers(parseModule(source)).size).toBe(0)
  }, 30_000)
})

describe("missed eliminations", () => {
  test("removes a closed three-function cycle", () => {
    let source = ts`
      function serialize(v) { return Array.isArray(v) ? serializeArray(v) : serializeObject(v) }
      function serializeArray(xs) { return xs.map(serialize) }
      function serializeObject(o) { return Object.values(o).map(serialize) }
      export function loader() { return serialize({ secret: process.env.SECRET }) }
      export default function Component() { return 1 }
    `
    let output = transform(source, { strip: ["loader"] })
    expect(output).not.toContain("serialize")
  })

  test("resolves a function declaration's name outside its own scope", () => {
    let source = ts`
      import { db } from "./db.server"
      function session(session) { return db.lookup(session.id) }
      export function loader({ request }) { return session(request) }
      export default function Component() { return 1 }
    `
    let output = transform(source, { strip: ["loader"] })
    expect(output).not.toContain("session")
    expect(output).not.toContain("./db.server")
  })

  test("output does not depend on whether scopes existed before the transform", () => {
    let source = ts`
      import { db } from "./db.server"
      export default function Page() {
        const query = db.query
        const onLoad = DROP(() => query("select 1"))
        return typeof onLoad
      }
    `
    let isDrop = (node: Babel.Node) =>
      t.isCallExpression(node) && t.isIdentifier(node.callee, { name: "DROP" })

    let traversed = parseModule(source)
    traverse(traversed, {
      CallExpression(path) {
        if (isDrop(path.node)) path.replaceWith(t.numericLiteral(0))
      },
    })
    deadCodeElimination(traversed)

    let untraversed = parseModule(source)
    t.traverseFast(untraversed, (node) => {
      if (t.isVariableDeclarator(node) && node.init && isDrop(node.init)) {
        node.init = t.numericLiteral(0)
      }
    })
    deadCodeElimination(untraversed)

    expect(generate(traversed).code).toBe(generate(untraversed).code)
    expect(generate(traversed).code).not.toContain("./db.server")
  })

  test("removes declarations that become unused inside functions", () => {
    let source = ts`
      export function f() {
        const a = 1
        const b = a
        return 1
      }
    `
    let output = transform(source, { candidates: "none" })
    expect(output).toBe(unchanged("export function f() { return 1 }"))
  })

  test("cleans up patterns inside functions after their bindings are removed", () => {
    let source = ts`
      export function keep() {
        const [used, [discarded], last] = [40, [9], 2]
        const alias = discarded
        return used + last
      }
    `
    let output = transform(source, { candidates: "none" })
    expect(output).not.toContain("discarded")
    expect(evaluate(output, "keep()")).toBe(42)
  })

  test("removes a class declaration that only a stripped export used", () => {
    let source = ts`
      import { db } from "./db.server"
      class PostRepo { all() { return db.post.findMany() } }
      export function loader() { return new PostRepo().all() }
      export default function Component() { return 1 }
    `
    let output = transform(source, { strip: ["loader"] })
    expect(output).not.toContain("PostRepo")
    expect(output).not.toContain("./db.server")
  })

  test.each([
    [
      "type alias",
      ts`
        import { z } from "zod"
        const Schema = z.object({ id: z.string() })
        type Schema = { id: string }
        export function action(body: unknown) { return Schema.parse(body) }
        export default function Component() { return 1 }
      `,
      "zod",
    ],
    [
      "interface",
      ts`
        import { z } from "zod"
        const Schema = z.object({ id: z.string() })
        interface Schema { id: string }
        export function action(body: unknown) { return Schema.parse(body) }
        export default function Component() { return 1 }
      `,
      "zod",
    ],
    [
      "overload signature",
      ts`
        import { db } from "./db.server"
        function get(id: string): string
        function get(id: any) { return db.get(id) }
        export function action() { return get("x") }
        export default function Component() { return 1 }
      `,
      "./db.server",
    ],
  ])(
    "a same-named TypeScript declaration does not keep a value alive (%s)",
    (_, source, leakedModule) => {
      let output = transform(source, { strip: ["action"], typescript: true })
      expect(output).not.toContain(leakedModule)
    },
  )
})
