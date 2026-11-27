---
"babel-dead-code-elimination": patch
---

Ignore computed keys on class members without a body when deciding whether an unused class runs code

A computed key with side effects keeps an unused class (changeset 26), but on a member without a body (a `declare` field, an abstract method or field, an overload signature) TypeScript erases the key with the member, so it never runs. Such keys no longer keep a class, the same way decorators on those members no longer do (changeset 49): `class K { declare [hook()]: number }` is removed when nothing reads it, at the module level and inside a function. The key of a method's implementation still counts.
