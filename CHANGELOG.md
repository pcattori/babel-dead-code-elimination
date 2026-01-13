# babel-dead-code-elimination

## 1.0.12

### Patch Changes

- 523872b: Fix so that empty candidate are treated as "don't eliminate anything"

## 1.0.11

### Patch Changes

- e67481b: Detect and eliminate circular references

## 1.0.10

### Patch Changes

- 698706a: Respect candidates within when eliminating unreferenced identifiers in an object pattern

## 1.0.9

### Patch Changes

- d255b12: Preserve unused variables in object patterns when rest element is used.
  That way, it remains filtered out of the rest element.

  For example:

  ```ts
  let { a, ...rest } = { a: 1, b: 2, c: 3 }
  //    ^ `a` is unused

  console.log(rest)
  // { b: 2, c: 3 }
  ```

  Eliminating `a` would incorrectly change runtime behavior:

  ```ts
  let { ...rest } = { a: 1, b: 2, c: 3 }

  console.log(rest)
  // { a: 1, b: 2, c: 3 }
  //   ^^^^^ this shouldn't be here...
  ```

  So it is preserved as-is instead.

## 1.0.8

### Patch Changes

- c653dd3: Do not eliminate `const`- nor `let`-declared for-loop iterator variables

  Previously, only `var`-declared iterator variables were preserved within `for...of` and `for...in` loops.
  Now, iterator variables declared via `const` and `let` are also preserved.

## 1.0.7

### Patch Changes

- 81ef06b:
  - Do not eliminate for-loop iterator variables (`for...of`/`for...in`)
  - Do not eliminate reassigned variables

## 1.0.6

### Patch Changes

- d4690c2: Do not eliminate empty object/array pattern function parameters

  Function parameters are not dead code

## 1.0.5

### Patch Changes

- 3cf19e5: Fix: do not check function expressions for referenced variables

  Function expressions do not add their names to outer scopes

- 5149b08: Do not eliminate arrow expressions

  Arrow expressions do not add names to the outer scope.
  Arrow expressions bound to names via variable declarators are already handled by `VariableDeclarator` visitor.

- 86af914: Do not eliminate unreferenced variables from array patterns and object patterns when they do not match the provided candidates

  Previously, the `candidates` were passed in to `deadCodeElimination` were not consulted when removing unreferenced variables from within patterns.
  This was a bug and has now been fixed.

## 1.0.4

### Patch Changes

- ade9eee: Fix: do not eliminate function expressions

  Function expressions do not add their names to outer scope, so they should never be dead code eliminated

## 1.0.3

### Patch Changes

- ce456b5: Fix referenced variable finding within object patterns and array patterns

## 1.0.2

### Patch Changes

- bd5e331: Fix elimination for object patterns and array patterns

  Previously, running dead code elimination on object patterns and array patterns (aka destructuring) was brittle.
  For example:

  ```ts
  const {
    a: { b: c },
  } = z
  console.log(c)
  ```

  Dead code elimination used to incorrectly remove the entire variable declaration even though `c` is referenced:

  ```diff
  -const {
  -  a: { b: c },
  -} = z
   console.log(c);
  ```

  This was caused by erroneous detection of `a` and `b` as unreferenced variables.
  But `a` and `b` are not variables, they are object property keys.
  Only `c` is a variable and it _is_ referenced.

  This is now corrected so that variables in object patterns and array patterns are detected only within values of object properties.
  This also correctly accounts for cases where the key and value are the same for example `{ a }`.

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
