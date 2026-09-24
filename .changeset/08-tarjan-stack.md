---
"babel-dead-code-elimination": patch
---

Find removable reference cycles without recursion. Several thousand chained
top-level declarations previously made `findReferencedIdentifiers` and
`deadCodeElimination` throw `RangeError: Maximum call stack size exceeded`.
