---
"babel-dead-code-elimination": patch
---

Keep unused object pattern properties that are filtered out of a rest element
when they have a default value (`{ a = 1, ...rest }`), are nested patterns
(`{ a: { b }, ...rest }`) or are part of a removable reference cycle.
Removing them silently added the property to `rest`.
