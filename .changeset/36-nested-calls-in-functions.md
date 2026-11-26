---
"babel-dead-code-elimination": patch
---

Keep declarations inside functions whose initializer calls anything when it runs

Changeset 27 kept `const id = useId()`, but not a call nested in a larger initializer, such as `const value = useCtx().value`, `const a = ready ? useA() : 0`, `const list = [useA()]` or `const a = useA() ?? 0`. Removing those from one build only changed which hooks run, too. Any call that the initializer evaluates now keeps the declaration; a call inside a nested function, as in `const later = () => useA()`, does not run and keeps nothing. A class or object initializer counts what creating it evaluates: computed keys, `extends`, static fields and static blocks, and the application of standard decorators (`const K = class { @register m() {} }`), but not method bodies or instance fields, which run later.
