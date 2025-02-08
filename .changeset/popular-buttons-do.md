---
"babel-dead-code-elimination": patch
---

Preserve unused variables in object patterns when rest element is used.
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
