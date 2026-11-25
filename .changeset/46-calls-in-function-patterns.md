---
"babel-dead-code-elimination": patch
---

Keep declarations inside functions whose pattern calls something

Changesets 27 and 36 keep a declaration inside a function whose initializer evaluates a call, such as `const id = useId()`, so that hooks run in the same order in every build. A call in the declaration's pattern runs too, in a default (`const { id = useId() } = props`, `const [id = useId()] = props`) or a computed key (`const { [useKey()]: value } = props`), and such declarations were still removed when their names became unused. They are now kept as well; a default that only defines a function, as in `{ onClick = () => track() }`, still runs nothing and keeps nothing.
