---
"babel-dead-code-elimination": patch
---

Count keys before an object rest as used only while the rest is used

`findReferencedIdentifiers` and `collectReferencedIdentifiers` counted every key listed before a `...rest` as used, whether or not anything read the rest. In `const { a, ...r } = mk(() => [a, r])`, where nothing else reads `a` or `r`, the set held `a`. The keys now count as used only while the rest does, so `a` and `r` form a closed cycle and are left out of the set like any other; `deadCodeElimination(ast, referenced)` keeps such a declaration as before.
