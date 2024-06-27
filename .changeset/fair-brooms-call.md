---
"babel-dead-code-elimination": patch
---

Fix elimination for object patterns and array patterns

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
