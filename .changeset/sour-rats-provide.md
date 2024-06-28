---
"babel-dead-code-elimination": patch
---

Do not eliminate arrow expressions

Arrow expressions do not add names to the outer scope.
Arrow expressions bound to names via variable declarators are already handled by `VariableDeclarator` visitor.
