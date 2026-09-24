---
"babel-dead-code-elimination": patch
---

Keep functions that a class (or another declaration kind elimination never
removes) references. They could be removed as part of a reference cycle with
the class, leaving the kept class calling an undefined function.
