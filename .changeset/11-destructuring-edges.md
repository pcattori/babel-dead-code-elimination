---
"babel-dead-code-elimination": patch
---

Keep code that a destructuring declaration's initializer needs while any of
its bindings survives. References in `const { a, b } = init()` were attributed
to only one binding, so removing a cycle through that binding could delete a
function the kept binding still calls.
