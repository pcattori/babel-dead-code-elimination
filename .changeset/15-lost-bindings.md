---
"babel-dead-code-elimination": patch
---

Never remove a declaration whose binding cannot be resolved. Removing an
unused local such as `const config` inside a function could make Babel drop a
same-named module-level binding, which was then removed although it was still
referenced or exported.
