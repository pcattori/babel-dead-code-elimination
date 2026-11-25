---
"babel-dead-code-elimination": patch
---

Match candidates by node, so a rebuilt declaration stays a candidate

`deadCodeElimination(ast, referenced)` matched a candidate by its path when deciding whether to remove it, but by its node when deciding what the kept code reads. A transform that rebuilds a declarator around its own id node, as in `path.replaceWith(t.variableDeclarator(path.node.id, g(b)))`, gives the id a new path: the declarator then stayed, as if it were not a candidate, while `b`, which only it reads, was removed, and the output threw a `ReferenceError`. Candidates are now matched by node everywhere, so such a declaration is removed or kept like any other candidate.
