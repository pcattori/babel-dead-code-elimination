---
"babel-dead-code-elimination": patch
---

Remove destructured elements whose default only reads them back

A reference in a destructuring default or computed key counted as a read from every name the declarator binds, so an element kept itself alive whenever its declarator was kept: in `const { handler = () => handler(), other } = config; use(other)`, `handler` stayed although nothing else read it. Such a reference now counts only for its own element, and for the `...rest` that filters the element out, since elimination removes the default or key with the element. Elements whose defaults read each other, or read a function that reads them back, are removed too, while an element listed before a kept `...rest` still stays.
