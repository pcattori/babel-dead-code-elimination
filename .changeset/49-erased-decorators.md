---
"babel-dead-code-elimination": patch
---

Remove unused classes whose only decorators are on declarations without a body

Changeset 26 keeps an unused class whose definition runs code, such as a decorator. Decorators on an overload signature (`@log m(p: number): void`) or its parameters, on an abstract member, or on a `declare` field never run: TypeScript erases these declarations together with their decorators. A class whose only decorators are of this kind is now removed like any other unused class without side effects. Decorators on a class, on a method or field with a body, and on an implementation's parameters still keep the class.
