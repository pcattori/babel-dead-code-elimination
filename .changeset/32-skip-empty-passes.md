---
"babel-dead-code-elimination": patch
---

Run another elimination pass only when the previous one can have made more code unused

A removal now schedules another pass only if a remaining declaration lost a reference or its last reassignment, a destructuring pattern changed shape, or a declaration had to wait because removing a same-named local dropped its binding from scope. Before, any removal triggered a second pass, which usually removed nothing.
