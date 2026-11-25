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
  /** Replace `DROP(...)` calls with `0` before DCE. */
  drop?: boolean
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
    plugins: typescript
      ? ["typescript", "jsx", "decorators-legacy"]
      : ["decorators-legacy"],
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
  { strip = [], drop, candidates = "references", typescript }: Options = {},
): string => {
  let ast = parseModule(code, typescript)
  let referenced =
    candidates === "references"
      ? findReferencedIdentifiers(ast)
      : candidates === "none"
        ? undefined
        : candidates(ast)
  if (strip.length > 0) stripExports(ast, strip)
  if (drop) {
    traverse(ast, {
      CallExpression(path) {
        if (t.isIdentifier(path.node.callee, { name: "DROP" })) {
          path.replaceWith(t.numericLiteral(0))
        }
      },
    })
  }
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
  test("removes what an unused declaration read before the transform stripped it", () => {
    let source = ts`
      import { db } from "./db.server"
      const x = createServerFn().handler(() => foo())
      const foo = () => db.query()
    `
    let ast = parseModule(source)
    let referenced = findReferencedIdentifiers(ast)
    traverse(ast, {
      CallExpression(path) {
        if (t.isMemberExpression(path.node.callee)) path.node.arguments = []
      },
    })
    deadCodeElimination(ast, referenced)
    expect(generate(ast).code).toBe("const x = createServerFn().handler();")
  })

  test("removes a variable reassigned only by a function that it reads", () => {
    let source = ts`
      import { db } from "./db.server"
      let cache = memo(() => refresh)
      function refresh() { cache = db.load() }
      export const value = 1
    `
    expect(transform(source, { candidates: "none" })).toBe(
      "export const value = 1;",
    )
  })

  test("removes a variable reassigned only in its own initializer", () => {
    let source = ts`
      let state = init(() => { state = 0 })
      export const value = 1
    `
    expect(transform(source, { candidates: "none" })).toBe(
      "export const value = 1;",
    )
  })

  test("keeps a variable reassigned by a function kept for another reason", () => {
    let source = ts`
      let cache = memo(() => refresh)
      function refresh() { cache = load() }
      export { refresh }
    `
    expect(transform(source, { candidates: "none" })).toBe(unchanged(source))
  })

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

  test("removes a declaration whose name a removed local repeats", () => {
    let source = ts`
      export function Component() {
        const config = 0
        return 1
      }
      const config = loadConfig()
    `
    expect(transform(source, { candidates: "none" })).not.toContain(
      "loadConfig",
    )
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

  test("removes a self-calling function once a removed local was its only outside use", () => {
    let source = ts`
      function loop() { return loop() }
      export function f() {
        const alias = loop
        return 1
      }
    `
    let output = transform(source, { candidates: "none" })
    expect(output).toBe(unchanged("export function f() { return 1 }"))
  })

  test("removes a self-calling function once a removed empty pattern was its only outside use", () => {
    let source = ts`
      function loop() { return loop() }
      const [] = make(loop)
      export const kept = 1
    `
    let output = transform(source, { candidates: "none" })
    expect(output).toBe(unchanged("export const kept = 1"))
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

describe("definition side effects", () => {
  test.each([
    [
      "class decorator",
      "@customElement('x-foo') class XFoo extends LitElement {}",
      false,
    ],
    ["member decorator", "class User { @Column() name = '' }", false],
    [
      "parameter decorator",
      "class Service { constructor(@Inject(Token) dep: Dep) {} }",
      true,
    ],
    ["static block", "class Setup { static { init() } }", false],
    [
      "static initializer",
      "class Config { static instance = createConfig() }",
      false,
    ],
    ["computed key", "class Keyed { [computeKey()]() {} }", false],
    ["extends call", "class Logged extends withLogging(Base) {}", false],
  ])(
    "keeps an unused class whose definition has effects (%s)",
    (_, declaration, typescript) => {
      let source = `${declaration}\nexport const x = 1`
      let output = transform(source, { candidates: "none", typescript })
      expect(output).toBe(unchanged(source, typescript))
    },
  )

  test("removes an unused class without definition effects", () => {
    let source = ts`
      class NotFound extends Error {
        static displayName = "NotFound";
        [Symbol.iterator]() {}
      }
      export const x = 1
    `
    let output = transform(source, { candidates: "none" })
    expect(output).toBe(unchanged("export const x = 1"))
  })
})

describe("calls in functions", () => {
  test("keeps hook calls whose results only stripped code used", () => {
    let source = ts`
      export function Field() {
        const widgetId = useId()
        const labelId = useId()
        return [labelId, DROP(widgetId)]
      }
    `
    let output = transform(source, { drop: true })
    expect(output).toContain("const widgetId = useId()")
  })

  test.each([
    ["a call", "const handle = register()", "handle"],
    ["an awaited call", "const handle = await register()", "handle"],
    ["a constructor call", "const handle = new Registration()", "handle"],
    ["a destructured call", "const { entry } = register()", "entry"],
    ["a member of a call", "const handle = useCtx().value", "handle"],
    ["a conditional call", "const handle = ready ? register() : 0", "handle"],
    ["an array of calls", "const handle = [register()]", "handle"],
    ["a call with a fallback", "const handle = register() ?? 0", "handle"],
    [
      "a sequence ending in a call",
      "const handle = (log(), register())",
      "handle",
    ],
  ])(
    "keeps a declaration initialized with %s whose result becomes unused",
    (_, declaration, name) => {
      let source = ts`
      export async function run() {
        ${declaration}
        const alias = ${name}
        return 1
      }
    `
      let output = transform(source, { candidates: "none" })
      expect(output.replace(/\s+/g, " ")).toContain(declaration)
      expect(output).not.toContain("alias")
    },
  )

  test("removes a declaration whose call is only in a nested function", () => {
    let source = ts`
      export function run() {
        const later = () => register()
        return 1
      }
    `
    expect(transform(source, { candidates: "none" })).not.toContain("later")
  })
})

describe("values used only in types", () => {
  test.each([
    ["typeof in a type alias", "type Input = z.infer<typeof schema>"],
    ["as typeof", "export const x = 0 as unknown as typeof schema"],
    ["satisfies typeof", "export const x = {} satisfies typeof schema"],
    ["type argument", "export const x = f<typeof schema>()"],
    ["implements", "export class C implements schema {}"],
    ["a computed key in an interface", "interface I { [schema]: number }"],
    ["a computed method key", "type T = { [schema.key](): void }"],
  ])("removes a value read only in %s", (_, usage) => {
    let source = ts`
      import { z } from "zod"
      const schema = z.object({})
      ${usage}
      export function loader() { return schema.parse(1) }
      export const fn = 1
    `
    let stripped = transform(source, { strip: ["loader"], typescript: true })
    let fresh = transform(source.replace(/export function loader.*\n/, ""), {
      candidates: "none",
      typescript: true,
    })
    for (let output of [stripped, fresh]) {
      expect(output).not.toContain("const schema")
      expect(output).not.toContain("zod")
    }
  })

  test.each([
    ["export type", "export type { schema }", ""],
    ["export { type }", "export { type schema, keep }", "export { keep };"],
    [
      "export type next to a same-named type",
      "type schema = number\nexport type { schema }",
      "type schema = number;\nexport type { schema };",
    ],
  ])("removes a value only %s exports", (_, usage, rest) => {
    let source = ts`
      import { z } from "zod"
      const schema = z.object({})
      const keep = 1
      ${usage}
    `
    let output = transform(source, { candidates: "none", typescript: true })
    expect(output).toBe(
      [rest.includes("keep") ? "const keep = 1;" : "", rest]
        .filter(Boolean)
        .join("\n"),
    )
  })

  test.each([
    ["typeof in an expression", "export const kind = typeof schema"],
    ["a computed key in a class", "export class C { [schema.key] = 1 }"],
  ])("keeps a value read by %s", (_, usage) => {
    let source = ts`
      import { z } from "zod"
      const schema = z.object({})
      ${usage}
    `
    let output = transform(source, { candidates: "none", typescript: true })
    expect(output).toContain("const schema")
  })
})

describe("object rest in a cycle", () => {
  test.each([
    ["itself", "const { a, b, ...rest } = make(() => rest)"],
    [
      "a function",
      "const { a, ...rest } = make(() => f())\nfunction f() { return rest }",
    ],
  ])("removes a dead declarator whose rest is read by %s", (_, source) => {
    expect(transform(source, { candidates: "none" })).toBe("")
  })

  test("keeps the keys of a live rest", () => {
    let source = "const { a, ...rest } = make(() => rest)\nexport { rest }"
    expect(transform(source, { candidates: "none" })).toBe(unchanged(source))
  })
})
