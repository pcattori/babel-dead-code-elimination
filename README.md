# babel-dead-code-elimination

Composable primitives for dead code elimination primitives in Babel

This package is **not a Babel plugin**, but rather a set of composable primitives to author your own Babel transforms and plugins.

## deadCodeElimination

Eliminates unused code from the Babel AST by repeatedly removing unreferenced identifiers.

```ts
import { parse } from "@babel/parser"
import generate from "@babel/generator"

import { deadCodeElimination } from "babel-dead-code-elimination"

let source = "..."
let ast = parse(source, { sourceType: "module" })
deadCodeElimination(ast)
let result = generate(ast).code
```

## findReferencedIdentifiers

Find identifiers that are currently referenced in the Babel AST.

Useful for limiting `deadCodeElimination` to only eliminate _newly_ unreferenced identifiers,
as a best effort to preserve any intentional side-effects in the source.

```ts
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import traverse from "@babel/traverse"

import {
  deadCodeElimination,
  findReferencedIdentifiers,
} from "babel-dead-code-elimination"

let source = "..."
let ast = parse(source, { sourceType: "module" })
let referenced = findReferencedIdentifiers(ast)

traverse(ast, {
  /* ... your custom transform goes here ... */
})

deadCodeElimination(ast, referenced)
let result = generate(ast).code
```
