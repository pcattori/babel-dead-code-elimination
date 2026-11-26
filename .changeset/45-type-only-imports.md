---
"babel-dead-code-elimination": patch
---

Remove an import that elimination leaves with only type specifiers

When elimination removed the last value specifier of an import such as `import { type User, getUser } from "./db.server"`, it kept `import { type User } from "./db.server"`. With `verbatimModuleSyntax`, TypeScript emits that as `import {} from "./db.server"`, which still loads the server module in a client build. Such an import now goes with its last value specifier. An import that had only type specifiers to begin with is left alone. An `import type` declaration loads no module: with candidates, it loses only the candidate specifiers elimination removes, like any other import.
