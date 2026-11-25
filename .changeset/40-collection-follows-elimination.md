---
"babel-dead-code-elimination": patch
---

Leave out of the referenced identifiers what elimination would not count as used

`findReferencedIdentifiers` and `collectReferencedIdentifiers` counted a destructured name read only by its own default, such as `handler` in `const { handler = () => handler(), other } = config`, and a variable reassigned only by code that it keeps alive, such as `cache` and `refresh` in `let cache = memo(() => refresh); function refresh() { cache = load(cache) }`, as referenced. Elimination removes both (changesets 37 and 38), so `deadCodeElimination(ast, referenced)` removed them even when no transform ran in between, although they were already unused. Reference collection now applies the same rules: these names are left out like the members of other closed cycles, and stay. Every other name is in the set as before.
