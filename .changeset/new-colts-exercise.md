---
"babel-dead-code-elimination": patch
---

Fix: do not eliminate function expressions

Function expressions do not add their names to outer scope, so they should never be dead code eliminated
