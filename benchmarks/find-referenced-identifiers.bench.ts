import { describe } from "vitest"
import { traverse } from "../src/babel-esm"
import {
  collectReferencedIdentifiers,
  findReferencedIdentifiers,
} from "../src/index"
import { benchConsuming, iterationsFor } from "./consuming"
import { parseWorkload, workloads } from "./workloads"

const scoped = (ast: ReturnType<typeof parseWorkload>) => {
  traverse(ast, { Program() {} })
  return ast
}

for (let workload of workloads) {
  describe(`reference analysis ${workload.name}`, () => {
    let iterations = iterationsFor(workload.code)
    benchConsuming(
      "findReferencedIdentifiers: fresh AST",
      () => parseWorkload(workload),
      (ast) => findReferencedIdentifiers(ast),
      iterations,
    )
    benchConsuming(
      "findReferencedIdentifiers: scopeIsFresh",
      () => scoped(parseWorkload(workload)),
      (ast) => findReferencedIdentifiers(ast, { scopeIsFresh: true }),
      iterations,
    )
    benchConsuming(
      "collectReferencedIdentifiers: read",
      () => parseWorkload(workload),
      (ast) => collectReferencedIdentifiers(ast, { visitor: {} })(),
      iterations,
    )
    benchConsuming(
      "collectReferencedIdentifiers: discarded",
      () => parseWorkload(workload),
      (ast) => collectReferencedIdentifiers(ast, { visitor: {} }),
      iterations,
    )
  })
}
