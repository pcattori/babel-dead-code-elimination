---
"babel-dead-code-elimination": patch
---

Remove dead object-rest declarators that are part of a cycle

`const { a, ...rest } = make(() => rest)` was never removed, because keys filtered out of a rest were kept unconditionally and kept the rest alive in turn. Those keys now stay only while their rest is kept.
