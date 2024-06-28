---
"babel-dead-code-elimination": patch
---

Fix: do not check function expressions for referenced variables

Function expressions do not add their names to outer scopes
