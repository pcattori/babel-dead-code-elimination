---
"babel-dead-code-elimination": patch
---

Remove unused `var` variables that are declared more than once

Babel records `var x` declared a second time as a reassignment of `x`, so `var x = load(); var x` was kept even when nothing read `x`. A `var` redeclaration now counts as another declaration of the same variable: an unused variable is removed with all of its declarations, and what they read can go too. Variables that are read, or reassigned by kept code, stay with every declaration.
