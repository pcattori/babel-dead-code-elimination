---
"babel-dead-code-elimination": patch
---

Count only standard decorators when deciding whether an unused class runs code

Changeset 26 keeps an unused class whose definition runs code, such as a decorator. Only standard decorators count: on the class, on a method with a body, on an accessor, and on a field that is neither `declare` nor abstract. Legacy decorators (TypeScript's `experimentalDecorators`) are not supported: a decorator on a parameter (`m(@inject x) {}`), on an overload signature or abstract member, or on a `declare` field, which standard decorators do not allow, no longer keeps a class, so `class D { m(@log x) {} }` is removed when nothing reads it.
