---
"babel-dead-code-elimination": major
---

Depend on Babel 8 (`@babel/core`, `@babel/parser`, `@babel/traverse`, `@babel/types`)

Pass ASTs and `NodePath`s from Babel 8. `deadCodeElimination` now matches `candidates` by their identifier nodes, so candidates still apply when a transform moves a declaration by mutating the AST directly (Babel 8 creates new paths for moved nodes).
