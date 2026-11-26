# babel-dead-code-elimination

Composable primitives for dead code elimination in Babel

This package is **not a Babel plugin**.
It is a library for authoring your own Babel transforms and plugins.

## Install

```sh
npm install babel-dead-code-elimination
```

## Usage

You have a Babel AST and want to transform it:

```ts
import type { ParseResult } from "@babel/parser"
import type { File } from "@babel/types"

type AST = ParseResult<File>

export function transform(ast: AST) {
  // your code to mutate the AST goes here...
}
```

> [!TIP]
> This example assumes that you already have a Babel AST. If you need to parse source code or generate source code, use [`@babel/parser`](https://babeljs.io/docs/babel-parser) and [`@babel/generator`](https://babeljs.io/docs/babel-generator).

### Dead code elimination

Use `deadCodeElimination` when you want to remove unreferenced identifiers:

```ts
import { deadCodeElimination } from "babel-dead-code-elimination"

export function transform(ast: AST) {
  deadCodeElimination(ast)
}
```

For example:

```ts
// Before
const name = "Ada"
const greeting = "Hello, " + name
const unusedMessage = "Goodbye"

console.log(greeting)

// After
const name = "Ada"
const greeting = "Hello, " + name

console.log(greeting)
```

### Only target certain identifiers for removal

`deadCodeElimination` has a second argument for specifying which identifiers to consider for removal.
When provided, any identifiers not specified **will not be removed**.

This can be extremely useful if you want to run dead code elimination _after_ a custom transform.
In such cases, you may want to preserve identifiers that were already unused in the original source.
That way dead code elimination only removes identifiers that are unused _because_ of your transform.

For example, use `findReferencedIdentifiers` to get a set of referenced identifiers _prior_ to your transform and only target those for elimination:

```ts
import traverse from "@babel/traverse"

import {
  deadCodeElimination,
  findReferencedIdentifiers,
} from "babel-dead-code-elimination"

export function transform(ast: AST) {
  const referenced = findReferencedIdentifiers(ast)

  traverse(ast, {
    // your custom transform goes here
  })

  deadCodeElimination(ast, referenced)
}
```

For example, if the custom transform removes the `console.log` call:

```ts
// Before the custom transform
const startup = initializeApplication()
const greeting = "Hello"

console.log(greeting)

// After the custom transform
const startup = initializeApplication()
const greeting = "Hello"

// After dead code elimination
const startup = initializeApplication()
```

`greeting` was referenced before the custom transform and became unused afterward, so it can be removed. `startup` was already unused, so it is preserved along with its potentially side-effectful initializer.

### Choose which calls keep a declaration inside a function

Inside a function, `deadCodeElimination` keeps an unused declaration whose
initializer calls something, such as `const id = useId()`: removing it from
one build only (for example the server build) can change which hooks run and
break hydration. By default every call counts, including calls that only
fetch data. Pass `keepLocalCall` to decide which calls keep their
declaration. It receives the path of each call, `new`, tagged template and
applied decorator that a declaration inside a function evaluates, before anything is
removed:

```ts
import { deadCodeElimination } from "babel-dead-code-elimination"

const isHookName = (name: string) => /^use[A-Z]/.test(name)

export function transform(ast: AST) {
  deadCodeElimination(ast, undefined, {
    keepLocalCall: (call) => {
      const node = call.node
      const callee =
        node.type === "Decorator"
          ? node.expression
          : node.type === "TaggedTemplateExpression"
            ? node.tag
            : node.callee
      return (
        (callee.type === "Identifier" && isHookName(callee.name)) ||
        (callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          isHookName(callee.property.name))
      )
    },
  })
}
```

For example:

```ts
// Before
export function Page() {
  const id = useId()
  const user = getSession().user
  return <Profile id={id} />
}

// After, with the hook rule above
export function Page() {
  const id = useId()
  return <Profile id={id} />
}
```

The second argument still takes the candidates, or `undefined` for none.

### Reuse scopes from an earlier traversal

If a read-only Babel traversal has already initialized scopes, pass
`{ scopeIsFresh: true }` to avoid rebuilding them during reference collection:

```ts
traverse(ast, {
  // Inspect the AST without changing it.
})
const referenced = findReferencedIdentifiers(ast, { scopeIsFresh: true })
```

Only use this option when the AST has not changed since that traversal. Omit it
after arbitrary AST mutations so the collector refreshes binding information.
`deadCodeElimination` always refreshes scopes after transformations.

### Share an analysis traversal

Use `collectReferencedIdentifiers` when your transform first inspects the AST.
It collects declaration paths during your analysis traversal and returns a
function that computes reference membership only when needed:

```ts
import {
  collectReferencedIdentifiers,
  deadCodeElimination,
} from "babel-dead-code-elimination"

export function transform(ast: AST) {
  const calls = []
  const readReferences = collectReferencedIdentifiers(ast, {
    visitor: {
      CallExpression(path) {
        if (path.get("callee").isIdentifier({ name: "removeThisCall" })) {
          calls.push(path)
        }
      },
    },
  })
  if (calls.length === 0) {
    return
  }
  const referenced = readReferences()
  for (const call of calls) {
    call.remove()
  }
  deadCodeElimination(ast, referenced)
}
```

The visitor must preserve the AST and bindings and visit every node. Do not
use `skip`, `stop`, `denylist`, `shouldSkip`, or other traversal pruning. Invoke
the returned function before any AST or binding mutation; it is not a snapshot of a mutable
AST. If the analysis finds no transformation, discard the function to avoid
reference-graph analysis. The optional `scopeIsFresh` flag follows the same
contract as `findReferencedIdentifiers`; otherwise the collector refreshes
scopes before your visitor runs.

## Limitations

- **`eval` is not supported.** Code that a direct `eval` reads is invisible to
  the analysis, so `const x = 1; eval("x")` removes `x`.
- **Types are not cleaned up.** References inside TypeScript types (`typeof x`,
  `x as typeof schema`, `implements X`, `{ [key]: T }`, `export type { x }`) do
  not keep a value alive, because types are erased before the code runs. The
  types themselves stay, so the output can contain a type that names a removed
  value, such as `type T = typeof schema`. Only a type-only export of a removed
  value goes with it, and a value import that elimination leaves with only
  type specifiers (`import { type User } from "./db.server"`); an
  `import type` declaration loses only the specifiers elimination removes.
  Strip types before type-checking the output, or do not type-check it.
- **The classic JSX runtime's import is not kept by JSX.** With the classic
  runtime, `<div />` compiles to `React.createElement("div")`, but before that
  compilation the module reads `React` nowhere, so `import React from "react"`
  is removed when only JSX would use it. Run elimination after the JSX
  transform, use the automatic runtime, or read the import in code.
- **Legacy decorators are not supported.** Only standard decorators keep an
  unused class: on the class, on a method with a body, on an accessor, and on
  a field that is neither `declare` nor abstract. A decorator that only
  TypeScript's `experimentalDecorators` allows, such as one on a parameter
  (`constructor(@Inject(Token) dep: Dep)`), counts for nothing, so a class
  that nothing reads is removed with it.
- **A name read only in types is never a candidate.** `findReferencedIdentifiers`
  leaves out a name that only types read, so it stays when your transform
  removes the code holding those type reads, as everything does that was
  already unused: in
  `import { UserRecord } from "./models.server"` with
  `createServerFn().handler(async () => load<UserRecord>())`, stripping the
  handler keeps the import. Remove such imports yourself, or strip types
  first.
- **A dead cycle that your transform cuts stays.** `findReferencedIdentifiers`
  leaves out names that only read each other in a closed cycle, such as `x` and
  `foo` in `const x = createServerFn().handler(() => foo()); const foo = () => x`.
  If your transform then strips `x`'s handler, `foo` was never a candidate, so
  `deadCodeElimination(ast, referenced)` keeps it. A destructured name read only
  by its own default (`const { handler = () => handler() } = config`) and a
  variable reassigned only by code that it keeps alive count as such cycles.

## Prior art

Credit to [Jason Miller](https://github.com/developit) for the initial implementation.
Thanks to these projects for exploring dead code elimination:

- [Next.js](https://github.com/vercel/next.js/pull/9652)
- [babel-plugin-eliminator](https://github.com/egoist/babel-plugin-eliminator/blob/d47034ed765352c02d588afdaa40510967332b21/src/index.ts)
- [bling](https://github.com/TanStack/bling/blob/c8ee1d1ae3009ecefc747edaad45a7dfba9ecc9f/packages/bling/src/compilers.ts)
