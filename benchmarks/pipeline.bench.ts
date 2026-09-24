import { bench, describe } from "vitest"
import { pipeline, workloads } from "./workloads"

// Parse, reference analysis, transform, elimination and generation, as
// consumers run them.
for (let workload of workloads) {
  describe(`pipeline ${workload.name}`, () => {
    bench("findReferencedIdentifiers", () => {
      pipeline(workload, "default")
    })
    bench("collectReferencedIdentifiers", () => {
      pipeline(workload, "collector")
    })
  })
}
