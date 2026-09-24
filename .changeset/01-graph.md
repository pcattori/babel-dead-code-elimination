---
"babel-dead-code-elimination": patch
---

Deduplicate binding-graph edges in constant time. Modules with many references to
the same declarations analyze their reference graph faster; no additional memory
is allocated.
