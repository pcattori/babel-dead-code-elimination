# babel-dead-code-elimination

## 1.0.1

### Patch Changes

- c2d0e23: Provide `main` and `module` fields in `package.json` for older bundlers

## 1.0.0

### Major Changes

- 8264d19: Initial release

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
