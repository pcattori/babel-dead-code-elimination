---
"babel-dead-code-elimination": patch
---

Match candidates by node, so a rebuilt declaration stays a candidate

A transform that rebuilds a declarator around its own id node, as in `path.replaceWith(t.variableDeclarator(path.node.id, init))`, gives the id a new path. `deadCodeElimination(ast, referenced)` matched candidates by path, so such a declaration was no longer a candidate and stayed even when the transform left it unused. Candidates are now matched by node, so it is removed like any other candidate, together with what only it reads.
