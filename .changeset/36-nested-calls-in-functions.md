---
"babel-dead-code-elimination": patch
---

Keep declarations inside functions whose initializer calls anything when it runs

Changeset 27 kept `const id = useId()`, but not a call nested in a larger initializer, such as `const value = useCtx().value`, `const a = ready ? useA() : 0`, `const list = [useA()]` or `const a = useA() ?? 0`. Removing those from one build only changed which hooks run, too. Any call that the initializer evaluates now keeps the declaration; a call inside a nested function, as in `const later = () => useA()`, does not run and keeps nothing.
