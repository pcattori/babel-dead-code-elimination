---
"babel-dead-code-elimination": patch
---

Keep empty patterns in `for...of` and `for...in` heads (`for (const {} of
items)`). Removing their declaration left the loop without a head and threw.
