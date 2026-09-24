import { describe, expect, test } from "vitest"
import generate from "@babel/generator"
import { deadCodeElimination } from "../src/index"
import { parseWorkload, pipeline, workloads } from "./workloads"

// Output parity for every benchmark workload. Performance changes must keep
// these snapshots unchanged.
describe("benchmark corpus output", () => {
  test.each(workloads)("$name", async (workload) => {
    let output = pipeline(workload, "default").code
    expect(pipeline(workload, "collector").code).toBe(output)
    await expect(output).toMatchFileSnapshot(
      `./__snapshots__/${workload.name}.pipeline.txt`,
    )

    let ast = parseWorkload(workload)
    deadCodeElimination(ast)
    await expect(generate(ast).code).toMatchFileSnapshot(
      `./__snapshots__/${workload.name}.fresh.txt`,
    )
  })
})
