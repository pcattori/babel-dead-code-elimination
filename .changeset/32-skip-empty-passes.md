---
"babel-dead-code-elimination": patch
---

Run another elimination pass only when the previous one can have made more code unused

A removal now schedules another pass only if a remaining declaration lost a reference or its last reassignment, or a destructuring pattern changed shape. Before, any removal triggered a second pass, which usually removed nothing.
