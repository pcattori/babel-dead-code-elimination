---
"babel-dead-code-elimination": patch
---

Skip ancestor checks for nonempty destructuring patterns and inspect object
rest elements without creating NodePaths.
