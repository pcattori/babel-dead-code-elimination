
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

## Prior art

Credit to [Jason Miller](https://github.com/developit) for the initial implementation.
Thanks to these projects for exploring dead code elimination:

- [Next.js](https://github.com/vercel/next.js/pull/9652)
- [babel-plugin-eliminator](https://github.com/egoist/babel-plugin-eliminator/blob/d47034ed765352c02d588afdaa40510967332b21/src/index.ts)
- [bling](https://github.com/TanStack/bling/blob/c8ee1d1ae3009ecefc747edaad45a7dfba9ecc9f/packages/bling/src/compilers.ts)
