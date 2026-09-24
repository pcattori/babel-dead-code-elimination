import { bench } from "vitest"

/**
 * Benchmarks an operation that consumes its input, such as elimination
 * mutating an AST. Vitest does not forward tinybench's per-iteration hooks, so
 * each warmup and run cycle prepares a fixed number of inputs in the `setup`
 * hook, outside the timed loop.
 */
export function benchConsuming<T>(
  name: string,
  prepare: () => T,
  run: (input: T) => void,
  iterations: number,
) {
  let inputs: T[] = []
  let warmupIterations = Math.max(4, Math.round(iterations / 4))
  bench(name, () => run(inputs.pop() ?? prepare()), {
    time: 0,
    iterations,
    warmupTime: 0,
    warmupIterations,
    setup: (_task, mode) => {
      let count = mode === "warmup" ? warmupIterations : iterations
      inputs = Array.from({ length: count }, prepare)
    },
  })
}

/** More iterations for smaller inputs, so each measurement takes similar time. */
export const iterationsFor = (code: string) =>
  Math.max(20, Math.min(2000, Math.round(400_000 / code.length)))
