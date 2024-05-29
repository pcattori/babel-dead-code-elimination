---
"babel-dead-code-elimination": major
---

Initial release

## deadCodeElimination

Eliminates unused code from the Babel AST by repeatedly removing unreferenced identifiers.

```ts
deadCodeElimination(ast)
```

## findReferencedIdentifiers

Find identifiers that are currently referenced in the Babel AST.

Useful for limiting `deadCodeElimination` to only eliminate _newly_ unreferenced identifiers,
as a best effort to preserve any intentional side-effects in the source.

```ts
let ast = parse(source, { sourceType: "module" })
let referenced = findReferencedIdentifiers(ast)

traverse(ast, {
  /* ... your custom transform goes here ... */
})

deadCodeElimination(ast, referenced)
```
