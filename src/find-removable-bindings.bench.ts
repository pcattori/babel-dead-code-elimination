import { bench, describe } from "vitest"
import { parse } from "@babel/parser"
import { Babel, traverse, type NodePath } from "./babel-esm"
import findRemovableBindings from "./find-removable-bindings"

// Helper to get program path from source
const getProgramPath = (source: string): NodePath<Babel.Program> => {
  const ast = parse(source, { sourceType: "module" })
  let progPath: NodePath<Babel.Program> | null = null
  traverse(ast, {
    Program(path) {
      progPath = path
      path.stop()
    },
  })
  return progPath!
}

// ============================================================================
// Scenario: No candidates (all externally referenced)
// ============================================================================
describe("n=0: no candidates", () => {
  const source = `
    function used() { return 1 }
    const value = used()
    console.log(value)
  `
  const programPath = getProgramPath(source)

  bench("all bindings externally used", () => {
    findRemovableBindings(programPath)
  })
})

// ============================================================================
// Scenario: n=1 single candidate
// ============================================================================
describe("n=1: single candidate", () => {
  const selfRefSource = `
    function f() { return f() }
  `
  const noSelfRefSource = `
    function f() { return 1 }
  `

  const selfRefPath = getProgramPath(selfRefSource)
  const noSelfRefPath = getProgramPath(noSelfRefSource)

  bench("self-referencing (removable)", () => {
    findRemovableBindings(selfRefPath)
  })

  bench("not self-referencing (not removable)", () => {
    findRemovableBindings(noSelfRefPath)
  })
})

// ============================================================================
// Scenario: n=2 two candidates
// ============================================================================
describe("n=2: two candidates", () => {
  const mutualSource = `
    function a() { return b() }
    function b() { return a() }
  `
  const oneSelfSource = `
    function a() { return a() }
    function b() { return 1 }
  `
  const noCycleSource = `
    function a() { return 1 }
    function b() { return 2 }
  `

  const mutualPath = getProgramPath(mutualSource)
  const oneSelfPath = getProgramPath(oneSelfSource)
  const noCyclePath = getProgramPath(noCycleSource)

  bench("mutual recursion (both removable)", () => {
    findRemovableBindings(mutualPath)
  })

  bench("one self-loop (one removable)", () => {
    findRemovableBindings(oneSelfPath)
  })

  bench("no cycles (none removable)", () => {
    findRemovableBindings(noCyclePath)
  })
})

// ============================================================================
// Scenario: n>=3 with no cycles (early exit)
// ============================================================================
describe("n>=3: no cycles (early exit)", () => {
  const linearChainSource = `
    function a() { return 1 }
    function b() { return a() }
    function c() { return b() }
    function d() { return c() }
    function e() { return d() }
  `

  const linearChainPath = getProgramPath(linearChainSource)

  bench("5 bindings, linear chain, no cycle", () => {
    findRemovableBindings(linearChainPath)
  })
})

// ============================================================================
// Scenario: n>=3 with cycles (full Tarjan)
// ============================================================================
describe("n>=3: has cycles (full Tarjan)", () => {
  const triangleSource = `
    function a() { return b() }
    function b() { return c() }
    function c() { return a() }
  `

  const twoSccsSource = `
    function a() { return b() }
    function b() { return a() }
    function x() { return y() }
    function y() { return x() }
  `

  const largeCircleSource = `
    function f0() { return f1() }
    function f1() { return f2() }
    function f2() { return f3() }
    function f3() { return f4() }
    function f4() { return f5() }
    function f5() { return f6() }
    function f6() { return f7() }
    function f7() { return f8() }
    function f8() { return f9() }
    function f9() { return f0() }
  `

  const trianglePath = getProgramPath(triangleSource)
  const twoSccsPath = getProgramPath(twoSccsSource)
  const largeCirclePath = getProgramPath(largeCircleSource)

  bench("3 bindings, triangle cycle", () => {
    findRemovableBindings(trianglePath)
  })

  bench("4 bindings, two separate SCCs", () => {
    findRemovableBindings(twoSccsPath)
  })

  bench("10 bindings, large circle", () => {
    findRemovableBindings(largeCirclePath)
  })
})

// ============================================================================
// Scenario: Mixed (some external, some candidates)
// ============================================================================
describe("mixed: external + candidates", () => {
  const mixedSource = `
    // Externally used
    function used1() { return 1 }
    console.log(used1())
    
    // Mutual recursion (removable)
    function a() { return b() }
    function b() { return a() }
    
    // Single unused
    function unused() { return 1 }
  `

  const mixedPath = getProgramPath(mixedSource)

  bench("mixed external and candidates", () => {
    findRemovableBindings(mixedPath)
  })
})

// ============================================================================
// Scenario: SCC with external incoming edge (not removable)
// ============================================================================
describe("SCC with external edge", () => {
  const sccWithExternalSource = `
    function a() { return b() }
    function b() { return a() }
    function c() { return a() }  // c references into the SCC
  `

  const sccWithExternalPath = getProgramPath(sccWithExternalSource)

  bench("SCC with incoming edge from outside", () => {
    findRemovableBindings(sccWithExternalPath)
  })
})

// ============================================================================
// Scenario: Large number of bindings (stress test)
// ============================================================================
describe("stress: many bindings", () => {
  // Generate 20 independent self-referencing functions
  const manySelfRefSource = Array.from(
    { length: 20 },
    (_, i) => `function f${i}() { return f${i}() }`,
  ).join("\n")

  // Generate 20 functions in a chain (no cycles)
  const manyLinearSource = [
    "function f0() { return 1 }",
    ...Array.from(
      { length: 19 },
      (_, i) => `function f${i + 1}() { return f${i}() }`,
    ),
  ].join("\n")

  // Generate 20 functions in a large cycle
  const manyCircularSource = [
    ...Array.from(
      { length: 19 },
      (_, i) => `function f${i}() { return f${i + 1}() }`,
    ),
    "function f19() { return f0() }",
  ].join("\n")

  const manySelfRefPath = getProgramPath(manySelfRefSource)
  const manyLinearPath = getProgramPath(manyLinearSource)
  const manyCircularPath = getProgramPath(manyCircularSource)

  bench("20 independent self-refs", () => {
    findRemovableBindings(manySelfRefPath)
  })

  bench("20 linear chain (no cycle, early exit)", () => {
    findRemovableBindings(manyLinearPath)
  })

  bench("20 circular (one large SCC)", () => {
    findRemovableBindings(manyCircularPath)
  })
})

// ============================================================================
// Scenario: Many SCCs (stresses SCC-closure detection)
// ==========================================================================
describe("stress: many SCCs", () => {
  const genPairSccSource = (pairs: number, chained: boolean): string => {
    const lines: string[] = []
    for (let i = 0; i < pairs; i++) {
      const next = chained && i + 1 < pairs ? ` a${i + 1}();` : ""
      lines.push(`function a${i}() { b${i}();${next} }`)
      lines.push(`function b${i}() { a${i}(); }`)
    }
    return lines.join("\n")
  }

  // 200 pairs => 400 bindings => 200 SCCs of size 2
  const manySccsDisconnectedPath = getProgramPath(genPairSccSource(200, false))
  const manySccsChainedPath = getProgramPath(genPairSccSource(200, true))

  bench("400 bindings, 200 SCCs, disconnected (all closed)", () => {
    findRemovableBindings(manySccsDisconnectedPath)
  })

  bench("400 bindings, 200 SCCs, chained (many incoming)", () => {
    findRemovableBindings(manySccsChainedPath)
  })
})

// ============================================================================
// Scenario: Constant violations and loop iterators (fast skip)
// ============================================================================
describe("fast skip: violations and iterators", () => {
  const violationsSource = `
    let a = 1
    a = 2
    let b = 1
    b = 3
    let c = 1
    c = 4
  `

  const violationsPath = getProgramPath(violationsSource)

  bench("bindings with constant violations", () => {
    findRemovableBindings(violationsPath)
  })
})
