---
"babel-dead-code-elimination": patch
---

Detect every closed reference cycle among up to three candidate bindings.
A special case for small candidate sets missed cycles such as `a ↔ c, b ↔ c`,
so whether they were removed depended on unrelated dead code.
