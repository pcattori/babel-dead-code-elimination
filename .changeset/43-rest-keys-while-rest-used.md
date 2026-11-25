---
"babel-dead-code-elimination": patch
---

Count keys before an object rest as used only while the rest is used

`findReferencedIdentifiers` and `collectReferencedIdentifiers` counted every key listed before a `...rest` as used, whether or not the rest was. In `const { a, ...r } = mk(() => [a, r])`, where nothing else reads `a` or `r`, both were in the set, and `deadCodeElimination(ast, referenced)` then removed the whole declaration even when no transform ran in between. The keys now count as used only while the rest does, as elimination already treated them, so such a declaration is left out of the set like any other closed cycle and stays.
