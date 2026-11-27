import { test } from "vitest"

/**
 * Registers a benchmark as its own test, through Vitest's `bench` fixture.
 * `options` are tinybench run options, such as a fixed iteration count.
 */
export function bench(
  name: string,
  fn: () => void,
  options: {
    beforeEach?: () => void
    iterations?: number
    warmupIterations?: number
  } = {},
) {
  let { beforeEach, ...run } = options
  test(name, async ({ bench }) => {
    let fixed =
      run.iterations === undefined ? {} : { time: 0, warmupTime: 0, ...run }
    await bench(name, beforeEach ? { beforeEach } : {}, fn).run(fixed)
  })
}

/**
 * Benchmarks an operation that consumes its input, such as elimination
 * mutating an AST. Each iteration gets a fresh input, prepared in tinybench's
 * `beforeEach` hook, outside the timed function.
 */
export function benchConsuming<T>(
  name: string,
  prepare: () => T,
  run: (input: T) => void,
  iterations: number,
) {
  let input: T
  bench(name, () => run(input), {
    beforeEach: () => {
      input = prepare()
    },
    iterations,
    warmupIterations: Math.max(4, Math.round(iterations / 4)),
  })
}

/** More iterations for smaller inputs, so each measurement takes similar time. */
export const iterationsFor = (code: string) =>
  Math.max(20, Math.min(2000, Math.round(400_000 / code.length)))
