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
  `x as typeof schema`, `implements X`, `{ [key]: T }`) do not keep a value
  alive, because types are erased before the code runs. The types themselves stay, so the output can
  contain a type that names a removed value, such as `type T = typeof schema`.
  Strip types before type-checking the output, or do not type-check it.
- **A dead cycle that your transform cuts stays.** `findReferencedIdentifiers`
  leaves out names that only read each other in a closed cycle, such as `x` and
  `foo` in `const x = createServerFn().handler(() => foo()); const foo = () => x`.
  If your transform then strips `x`'s handler, `foo` was never a candidate, so
  `deadCodeElimination(ast, referenced)` keeps it.

## Prior art

Credit to [Jason Miller](https://github.com/developit) for the initial implementation.
Thanks to these projects for exploring dead code elimination:

- [Next.js](https://github.com/vercel/next.js/pull/9652)
- [babel-plugin-eliminator](https://github.com/egoist/babel-plugin-eliminator/blob/d47034ed765352c02d588afdaa40510967332b21/src/index.ts)
- [bling](https://github.com/TanStack/bling/blob/c8ee1d1ae3009ecefc747edaad45a7dfba9ecc9f/packages/bling/src/compilers.ts)
