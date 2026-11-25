---
"babel-dead-code-elimination": patch
---

Leave names read only inside TypeScript types out of `findReferencedIdentifiers`

Since changeset 30, a value read only inside a type does not keep it alive during elimination. `findReferencedIdentifiers`, `collectReferencedIdentifiers`, and the `scopeIsFresh` path follow the same rule: `schema` in `const schema = z.object({}); type T = typeof schema` is not in the returned set, where 2.0.0 included it. A transform that passes the set to `deadCodeElimination` therefore treats such a value as unreferenced before the transform, as elimination does. Reads in value positions, such as `typeof schema` in an expression or `import a = schema.b`, still count.
