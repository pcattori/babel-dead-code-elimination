import { describe } from "vitest"
import { deadCodeElimination } from "../src/index"
import { benchConsuming, iterationsFor } from "./consuming"
import { parseWorkload, prepareElimination, workloads } from "./workloads"

for (let workload of workloads) {
  describe(`deadCodeElimination ${workload.name}`, () => {
    let iterations = iterationsFor(workload.code)
    // After findReferencedIdentifiers and the transform, with candidates.
    benchConsuming(
      "after transform",
      () => prepareElimination(workload),
      ({ ast, referenced }) => deadCodeElimination(ast, referenced),
      iterations,
    )
    // A freshly parsed AST without candidates.
    benchConsuming(
      "fresh AST",
      () => parseWorkload(workload),
      (ast) => deadCodeElimination(ast),
      iterations,
    )
  })
}
