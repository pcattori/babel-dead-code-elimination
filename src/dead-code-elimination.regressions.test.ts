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
  test("keeps a candidate whose declarator a transform rebuilds around its id", () => {
    let source = ts`
      const a = h()
      const b = () => 1
      use(a, b)
    `
    let ast = parseModule(source)
    let referenced = findReferencedIdentifiers(ast)
    let rebuilt = false
    traverse(ast, {
      ExpressionStatement(path) {
        path.remove()
      },
      VariableDeclarator(path) {
        let id = path.node.id
        if (rebuilt || !t.isIdentifier(id, { name: "a" })) return
        rebuilt = true
        // The id node moves into a new declarator, so its path is new.
        path.replaceWith(
          t.variableDeclarator(
            id,
            t.callExpression(t.identifier("g"), [t.identifier("b")]),
          ),
        )
      },
    })
    deadCodeElimination(ast, referenced)
    expect(generate(ast).code).toBe("")
  })

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

  test.each([
    [
      "a default",
      "const { a, k: {} = def(q) } = mk(); const q = 1",
      "const {\n  k: {} = def(q)\n} = mk();\nconst q = 1;",
    ],
    [
      "a nested default",
      "const { k: { a, e: {} } = def(q) } = mk(); const q = 1",
      "const {\n  k: {\n    e: {}\n  } = def(q)\n} = mk();\nconst q = 1;",
    ],
    [
      "its initializer",
      "const { a, k: {} } = mk(() => q); const q = 1",
      "const {\n  k: {}\n} = mk(() => q);\nconst q = 1;",
    ],
    [
      "its initializer, which reads its own element",
      "const [a, []] = mk(() => a)",
      "const [a, []] = mk(() => a);",
    ],
  ])(
    "keeps what an already-empty pattern's declarator reads in %s (candidates)",
    (_, source, expected) => {
      let output = transform(source, {
        candidates: (ast) => {
          let candidates = new Set<NodePath<Babel.Identifier>>()
          traverse(ast, {
            Identifier(path) {
              if (path.isBindingIdentifier()) candidates.add(path)
            },
          })
          return candidates
        },
      })
      expect(output).toBe(expected)
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

  test.each([
    [
      "its own element",
      "const { handler = () => handler(), other } = config; use(other)",
      "const {\n  other\n} = config;\nuse(other);",
    ],
    [
      "its own array element",
      "const [handler = () => handler(), other] = config; use(other)",
      "const [, other] = config;\nuse(other);",
    ],
    [
      "a sibling that reads it back",
      "const { a = () => b, b = () => a, c } = config; use(c)",
      "const {\n  c\n} = config;\nuse(c);",
    ],
    [
      "a function that reads it back",
      "const { a = () => g(), b } = config; function g() { return a } use(b)",
      "const {\n  b\n} = config;\nuse(b);",
    ],
    [
      "the rest that filters it",
      "const { a, [rest.key]: b, ...rest } = config; use(a)",
      "const {\n  a\n} = config;\nuse(a);",
    ],
  ])(
    "removes an element whose default or key reads only %s",
    (_, source, expected) => {
      expect(transform(source, { candidates: "none" })).toBe(expected)
    },
  )

  test("keeps an element that reads itself before a kept rest", () => {
    let source = "const { a = () => a, ...rest } = config; use(rest)"
    expect(transform(source, { candidates: "none" })).toBe(unchanged(source))
  })

  test.each([
    "const { handler = () => handler(), other } = config\nexport const page = () => other",
    "const [handler = () => handler(), other] = config\nexport const page = () => other",
    "let cache = memo(() => refresh)\nfunction refresh() { cache = load(cache) }\nexport const page = 1",
    "const { a, ...r } = mk(() => [a, r])\nexport const z = 1",
  ])("changes nothing without a transform: %s", (source) => {
    expect(transform(source)).toBe(unchanged(source))
  })

  test.each([
    ["var x = a\nvar x\nexport const z = 1", "export const z = 1;"],
    ["var x = a\nvar x = b\nexport const z = 1", "export const z = 1;"],
    ["var x = a\nvar x\nuse(x)", "var x = a;\nvar x;\nuse(x);"],
    [
      "var x = a\nif (k) var x\nexport const z = 1",
      "if (k) {}\nexport const z = 1;",
    ],
    [
      "var x = a\nswitch (k) { case 1: var x }\nexport const z = 1",
      "switch (k) {\n  case 1:\n}\nexport const z = 1;",
    ],
    ["var x = a\nL: var x\nexport const z = 1", "export const z = 1;"],
    [
      "var x = a\nwhile (k) var x\nexport const z = 1",
      "while (k) {}\nexport const z = 1;",
    ],
    [
      "var x = a\nfor (var x of xs) {}\nexport const z = 1",
      "var x = a;\nfor (var x of xs) {}\nexport const z = 1;",
    ],
  ])(
    "removes an unused var with its redeclarations: %s",
    (source, expected) => {
      expect(transform(source, { candidates: "none" })).toBe(expected)
    },
  )

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
    ["a static field", "class C { static x = cfg }"],
    ["a computed method key", "class C { [cfg]() {} }"],
    ["a static computed key", "class C { static [cfg] = 1 }"],
  ])("removes an unused class and the module name %s reads", (_, cls) => {
    for (let declaration of [
      "const cfg = mk()",
      'import { cfg } from "./config.server"',
    ]) {
      let source = `${declaration}\n${cls}\nexport const z = 1`
      for (let candidates of ["none", "references"] as const) {
        let output = transform(source, {
          candidates:
            candidates === "none"
              ? "none"
              : (ast) => {
                  let set = new Set<NodePath<Babel.Identifier>>()
                  traverse(ast, {
                    Identifier(path) {
                      if (path.isBindingIdentifier()) set.add(path)
                    },
                  })
                  return set
                },
        })
        expect(output).toBe("export const z = 1;")
      }
    }
  })

  test.each([
    [
      "class decorator",
      "@customElement('x-foo') class XFoo extends LitElement {}",
      false,
    ],
    ["member decorator", "class User { @Column() name = '' }", false],
    ["static block", "class Setup { static { init() } }", false],
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
    ["a call in a default", "const { handle = useId() } = props", "handle"],
    [
      "a call in a computed key",
      "const { [useKey()]: handle } = props",
      "handle",
    ],
    [
      "a call in an array default",
      "const [handle = useId()] = props",
      "handle",
    ],
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
  test("removes an import left with only type specifiers", () => {
    let source = ts`
      import { type User, getUser } from "./db.server"
      export const loader = async (): Promise<User> => getUser()
      export default function Route() { return 1 }
    `
    let output = transform(source, { strip: ["loader"], typescript: true })
    expect(output).not.toContain("db.server")
  })

  test("keeps an import that had only type specifiers to begin with", () => {
    let source = ts`
      import { type User } from "./db.server"
      export const user: User = load()
    `
    expect(transform(source, { typescript: true })).toBe(
      unchanged(source, true),
    )
  })

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

describe("unused cycles inside functions", () => {
  test.each([
    [
      "a function body",
      "export function f() {\n  const a = () => b();\n  const b = () => a();\n  return 1;\n}",
      "export function f() {\n  return 1;\n}",
    ],
    [
      "a block",
      "if (x) {\n  function a() {\n    return b();\n  }\n  function b() {\n    return a();\n  }\n}",
      "if (x) {}",
    ],
  ])(
    "removes locals that only read each other in %s",
    (_, source, expected) => {
      expect(transform(source, { candidates: "none" })).toBe(expected)
    },
  )

  test("keeps a local cycle that a kept local reads", () => {
    let source =
      "export function f() {\n  const a = () => b();\n  const b = () => a();\n  return a;\n}"
    expect(transform(source, { candidates: "none" })).toBe(unchanged(source))
  })
})

describe("decorators that are not standard decorators", () => {
  test.each([
    ["an overload", "class C { @log m(p: number): void; m(p?: any) {} }"],
    [
      "an overload's parameter",
      "class C { m(@log p: number): void; m(p?: any) {} }",
    ],
    ["a declare field", "class C { @log declare s: number }"],
    ["an abstract method", "abstract class C { @log abstract m(): void }"],
    [
      "an abstract method's parameter",
      "abstract class C { abstract m(@log p): void }",
    ],
    ["an abstract field", "abstract class C { @log abstract s: number }"],
    // Legacy parameter decorators are not supported (R3-D6).
    [
      "an implementation's parameter",
      "class C { m(@log p: number): void; m(@log p?: any) {} }",
    ],
    [
      "a constructor parameter",
      "class Service { constructor(@Inject(Token) dep: Dep) {} }",
    ],
  ])("removes an unused class whose only decorator is on %s", (_, source) => {
    expect(transform(source, { candidates: "none", typescript: true })).toBe("")
  })

  test.each([
    ["method", "class C { @log m(p: number): void; @log m(p?: any) {} }"],
    ["getter", "class C { @log get g() { return 1 } }"],
    ["field", "class C { @log s: number }"],
  ])(
    "keeps an unused class with a decorated implementation %s",
    (_, source) => {
      let output = transform(source, { candidates: "none", typescript: true })
      expect(output).toContain("class C")
    },
  )
})

describe("a class judged after a same-named binding was removed", () => {
  test.each([
    [
      "a module constant",
      "{ const cfg = 0 }\n{ class C { [cfg]() {} } }\nconst cfg = 1\nexport { cfg }",
      "{}\n{}\nconst cfg = 1;\nexport { cfg };",
    ],
    [
      "a module constant, in a function",
      'export function g() {\n  { const cfg = 0 }\n  class C { [cfg]() {} }\n}\nconst cfg = "k"',
      "export function g() {\n  {}\n}",
    ],
    [
      "a parameter",
      "export function g(cfg) {\n  { const cfg = 0 }\n  class C { [cfg]() {} }\n}",
      "export function g(cfg) {\n  {}\n}",
    ],
  ])(
    "removes an unused class whose computed key reads %s that a nested block redeclares",
    (_, source, expected) => {
      expect(transform(source, { candidates: "none" })).toBe(expected)
    },
  )
})

describe("scopes after elimination", () => {
  // Every scope's names, kinds and reference counts, in traversal order.
  let scopes = (ast: Babel.File) => {
    let out: string[] = []
    traverse(ast, {
      Scopable(path) {
        if (path.scope.block !== path.node) return
        let bindings = path.scope.bindings
        out.push(
          Object.keys(bindings)
            .sort()
            .map((n) => `${n}:${bindings[n]?.kind}:${bindings[n]?.references}`)
            .join(","),
        )
      },
    })
    return out
  }

  test.each([
    "export function g(cfg) {\n  { const cfg = 0 }\n  return () => cfg\n}",
    "export function g() {\n  try {} catch (e) {\n    { const e = 0 }\n    return e\n  }\n}",
    "export const f = function g() {\n  { const g = 0 }\n  return g\n}",
    "const s = mk()\nconst t = 2\nconsole.log(t)\nexport type { s as t }",
  ])(
    "equal a fresh crawl's when a removal names another binding: %s",
    (source) => {
      let ast = parseModule(source, true)
      deadCodeElimination(ast)
      expect(scopes(ast)).toEqual(scopes(t.cloneNode(ast, true)))
    },
  )
})

describe("import type declarations", () => {
  let named =
    (...names: string[]) =>
    (ast: Babel.File) => {
      let set = new Set<NodePath<Babel.Identifier>>()
      traverse(ast, {
        Identifier(path) {
          if (names.includes(path.node.name) && path.isBindingIdentifier())
            set.add(path)
        },
      })
      return set
    }

  test("keep the specifiers outside the candidates", () => {
    let source = ts`
      import type { A, B } from "./db.server"
      type T = B
    `
    expect(
      transform(source, { candidates: named("A"), typescript: true }),
    ).toBe('import type { B } from "./db.server";\ntype T = B;')
  })

  test("keep a specifier that kept code reads", () => {
    let source = ts`
      import type { A, B } from "./db.server"
      export { A }
    `
    expect(transform(source, { candidates: "none", typescript: true })).toBe(
      'import type { A } from "./db.server";\nexport { A };',
    )
  })
})

describe("calls a class or object initializer evaluates", () => {
  test.each([
    ["an object's computed method key", "{ [hook()]() {} }", true],
    [
      "an object's computed getter key",
      "{ get [hook()]() { return 1 } }",
      true,
    ],
    ["an object method's body", "{ m() { hook() } }", false],
    ["a class's computed method key", "class { [hook()]() {} }", true],
    ["a class's extends", "class extends hook() {}", true],
    ["a class's instance field", "class { x = hook() }", false],
    ["a class's static field", "class { static x = hook() }", true],
    ["a class's static block", "class { static { hook() } }", true],
    ["a class member's decorator", "class { @register m() {} }", true],
    ["a class's decorator", "@register class {}", true],
    ["a parameter decorator", "class { m(@register p) {} }", false],
  ])("in a function, %s", (_, init, kept) => {
    let source = `export function F() {\n  const K = ${init}\n  return 0\n}`
    let output = transform(source, { candidates: "none", typescript: true })
    expect(output.includes("const K")).toBe(kept)
  })
})

describe("static field initializers", () => {
  test("count for nothing in an unused module-level class", () => {
    let source = ts`
      import { connect } from "~/db.server"
      class Repo { static db = connect() }
      export const z = 1
    `
    expect(transform(source, { candidates: "none" })).toBe(
      "export const z = 1;",
    )
  })

  test.each([
    ["calls", "class K { static s = hook() }", true],
    ["calls nothing", "class K { static s = 0 }", false],
  ])(
    "keep a class declared in a function like a constant when it %s",
    (_, cls, kept) => {
      let source = `export function F() {\n  ${cls}\n  return 0\n}`
      let output = transform(source, { candidates: "none" })
      expect(output.includes("class K")).toBe(kept)
    },
  )
})

describe("computed keys on members without a body", () => {
  test.each([
    ["a declare field", "class K { declare [hook()]: number }"],
    ["an abstract method", "abstract class K { abstract [hook()](): void }"],
    ["an abstract field", "abstract class K { abstract [hook()]: number }"],
    ["an overload signature", "class K { [hook()](): void; m() {} }"],
  ])("run nothing on %s", (_, cls) => {
    let source = `${cls}\nexport const z = 1`
    expect(transform(source, { candidates: "none", typescript: true })).toBe(
      "export const z = 1;",
    )
  })

  test("run on an implementation beside its overload", () => {
    let source = ts`
      class K { [hook()](p: number): void; [hook()](p?: any) {} }
      export const z = 1
    `
    expect(
      transform(source, { candidates: "none", typescript: true }),
    ).toContain("class K")
  })

  test("keep no class expression inside a function", () => {
    let source = ts`
      export function F() {
        const K = class { declare [hook()]: number }
        return 0
      }
    `
    expect(
      transform(source, { candidates: "none", typescript: true }),
    ).not.toContain("class")
  })
})

describe("keepLocalCall", () => {
  let isHook = (name: string) => /^use[A-Z]/.test(name)
  let hookRule = (call: NodePath) => {
    let node = call.node
    let callee = t.isDecorator(node)
      ? node.expression
      : t.isTaggedTemplateExpression(node)
        ? node.tag
        : (node as Babel.CallExpression).callee
    if (t.isIdentifier(callee)) return isHook(callee.name)
    return (
      t.isMemberExpression(callee) &&
      !callee.computed &&
      t.isIdentifier(callee.property) &&
      isHook(callee.property.name)
    )
  }
  let source = ts`
    export function Page() {
      const id = useId()
      const state = React.useState(0)
      const user = db.users.find(1)
      const name = getSession().user.name
      const K = class { static s = useMemo() }
      return 1
    }
  `
  let eliminate = (keepLocalCall?: (call: NodePath) => boolean) => {
    let ast = parseModule(source)
    deadCodeElimination(ast, undefined, { keepLocalCall })
    return generate(ast).code
  }

  test("keeps only the locals whose calls the predicate accepts", () => {
    expect(eliminate(hookRule)).toBe(ts`
      export function Page() {
        const id = useId();
        const state = React.useState(0);
        const K = class {
          static s = useMemo();
        };
        return 1;
      }
    `)
  })

  test("keeps every call without the option", () => {
    expect(eliminate()).toBe(unchanged(source))
  })

  test.each([
    "class Repo { static { db.connect() } }",
    "class Repo { static { cache.n = 1 } }",
    "class Repo { [cache.key]() {} }",
    "@register class Repo {}",
  ])(
    "judges a class declaration in a function like a class expression: %s",
    (cls) => {
      let code = `import { db } from "./db.server"\nexport function Page() {\n  ${cls}\n  const id = useId()\n  return id\n}`
      let ast = parseModule(code)
      deadCodeElimination(ast, undefined, { keepLocalCall: hookRule })
      expect(generate(ast).code).toBe(ts`
        export function Page() {
          const id = useId();
          return id;
        }
      `)
      let kept = parseModule(code)
      deadCodeElimination(kept)
      expect(generate(kept).code).toContain("class Repo")
    },
  )

  test("receives each call and applied decorator, before any removal", () => {
    let seen: string[] = []
    let ast = parseModule(ts`
      export function Page() {
        const a = f(g())
        const K = class { @register m() {} }
        { const f = 0 }
        return 1
      }
    `)
    deadCodeElimination(ast, undefined, {
      keepLocalCall: (call) => {
        seen.push(`${call.node.type}:${call.scope.hasBinding("f")}`)
        return false
      },
    })
    expect(seen).toEqual([
      "CallExpression:false",
      "CallExpression:false",
      "Decorator:false",
    ])
  })
})
