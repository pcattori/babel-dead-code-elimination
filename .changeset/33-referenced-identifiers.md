---
"babel-dead-code-elimination": patch
---

Return the referenced identifiers that a transform can make unused again

The reachability change (changeset 29) also changed `findReferencedIdentifiers` and `collectReferencedIdentifiers`: they left out names that only unused code read, such as `foo` and `db` in `const x = createServerFn().handler(() => foo()); const foo = () => db.query()`. A transform that then stripped `x`'s handler could not remove `foo` and the `db` import, because they were no longer candidates. The set is restored to what it was before that change: every declared name that something reads, except the members of a closed dead cycle. Elimination itself still finds removable bindings by reachability.
