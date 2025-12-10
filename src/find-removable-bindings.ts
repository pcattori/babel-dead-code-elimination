import { type NodePath, type Babel, type Binding } from "./babel-esm"

/** Finds bindings forming closed SCCs with no external references. */
export default function findRemovableBindings(
  programPath: NodePath<Babel.Program>,
): Set<Binding> {
  const allBindings = Object.values(programPath.scope.bindings)
  const n = allBindings.length
  if (n === 0) return new Set()

  // Build a graph of bindings for cycle detection (used by shortcuts and Tarjan's algorithm)
  // if binding `a` is referenced inside binding `b`'s definition, refs[b] contains a
  // Map each binding's declaration node to its index for fast lookup when tracing refs
  const pathNodeToIdx = new Map<Babel.Node, number>()
  const refs: (number[] | null)[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const b = allBindings[i]!
    if (b.path?.node) pathNodeToIdx.set(b.path.node, i)
    refs[i] = null
  }

  // Mark bindings as excluded (not removable) if they have external refs, reassignments, or are loop iterators
  const excluded = new Uint8Array(n)
  // excluded bindings whose refs need to be excluded too
  const exclusionQueue: number[] = []
  // bindings that might be removable
  let candidateCount = n

  for (let i = 0; i < n; i++) {
    const binding = allBindings[i]!

    if (
      binding.constantViolations.length > 0 ||
      isLoopIteratorBinding(binding)
    ) {
      excluded[i] = 1
      candidateCount--
      exclusionQueue.push(i)
      continue
    }

    for (const refPath of binding.referencePaths) {
      // Walk up the AST to find which binding (if any) contains this reference
      let path: NodePath | null = refPath
      let containerIdx: number | undefined
      while (path) {
        containerIdx = pathNodeToIdx.get(path.node)
        if (containerIdx !== undefined) break
        path = path.parentPath
      }
      if (containerIdx !== undefined) {
        const containerRefs = refs[containerIdx]
        if (!containerRefs) {
          refs[containerIdx] = [i]
        } else if (!containerRefs.includes(i)) {
          containerRefs.push(i)
        }
      } else if (!excluded[i]) {
        excluded[i] = 1
        candidateCount--
        exclusionQueue.push(i)
        break
      }
    }
  }

  // Propagate exclusions: if excluded binding `a` references `b`, then `b` is also not removable
  while (exclusionQueue.length > 0) {
    const idx = exclusionQueue.pop()!
    const targets = refs[idx]
    if (targets) {
      for (const target of targets) {
        if (!excluded[target]) {
          excluded[target] = 1
          candidateCount--
          exclusionQueue.push(target)
        }
      }
    }
  }

  if (candidateCount === 0) return new Set()

  // Small candidate shortcuts (avoid Tarjan overhead for simple cases)
  if (candidateCount <= 3) {
    const candidates: number[] = []
    for (let i = 0; i < n && candidates.length < candidateCount; i++) {
      if (!excluded[i]) candidates.push(i)
    }

    // n=1 shortcut: single candidate is removable only if self-referencing
    if (candidateCount === 1) {
      const idx = candidates[0]!
      return refs[idx]?.includes(idx) ? new Set([allBindings[idx]!]) : new Set()
    }

    // n=2 shortcut: check for mutual recursion or self-refs
    if (candidateCount === 2) {
      const [aIdx, bIdx] = candidates as [number, number]

      // Mutual recursion: both reference each other
      const aRefs = refs[aIdx]
      const bRefs = refs[bIdx]
      const aRefsB = aRefs?.includes(bIdx)
      const bRefsA = bRefs?.includes(aIdx)

      if (aRefsB && bRefsA) {
        return new Set([allBindings[aIdx]!, allBindings[bIdx]!])
      }

      // Otherwise only self-referencing ones are removable
      const result = new Set<Binding>()
      if (aRefs?.includes(aIdx)) result.add(allBindings[aIdx]!)
      if (bRefs?.includes(bIdx)) result.add(allBindings[bIdx]!)
      return result
    }

    // n=3 shortcut: check for triangle cycle, pair cycles, or self-refs
    const [aIdx, bIdx, cIdx] = candidates as [number, number, number]

    const aRefs = refs[aIdx]
    const bRefs = refs[bIdx]
    const cRefs = refs[cIdx]

    const aRefsB = aRefs?.includes(bIdx),
      aRefsC = aRefs?.includes(cIdx)
    const bRefsA = bRefs?.includes(aIdx),
      bRefsC = bRefs?.includes(cIdx)
    const cRefsA = cRefs?.includes(aIdx),
      cRefsB = cRefs?.includes(bIdx)

    // Triangle: A→B→C→A or A→C→B→A (any cycle involving all 3)
    if ((aRefsB && bRefsC && cRefsA) || (aRefsC && cRefsB && bRefsA)) {
      return new Set([
        allBindings[aIdx]!,
        allBindings[bIdx]!,
        allBindings[cIdx]!,
      ])
    }

    const result = new Set<Binding>()

    // Check pair cycles (mutual recursion between any 2, with no incoming edge from 3rd)
    if (aRefsB && bRefsA && !cRefsA && !cRefsB) {
      result.add(allBindings[aIdx]!)
      result.add(allBindings[bIdx]!)
    }
    if (aRefsC && cRefsA && !bRefsA && !bRefsC) {
      result.add(allBindings[aIdx]!)
      result.add(allBindings[cIdx]!)
    }
    if (bRefsC && cRefsB && !aRefsB && !aRefsC) {
      result.add(allBindings[bIdx]!)
      result.add(allBindings[cIdx]!)
    }

    // Self-referencing
    if (aRefs?.includes(aIdx)) result.add(allBindings[aIdx]!)
    if (bRefs?.includes(bIdx)) result.add(allBindings[bIdx]!)
    if (cRefs?.includes(cIdx)) result.add(allBindings[cIdx]!)

    return result
  }

  // 4+ candidates: use Tarjan's SCC algorithm to find cycles
  const indices = new Int32Array(n).fill(-1)
  const lowlink = new Int32Array(n)
  const onStack = new Uint8Array(n)
  const stack: number[] = []
  const sccs: number[][] = []
  const sccId = new Int32Array(n).fill(-1)
  let index = 0

  const strongconnect = (v: number): void => {
    indices[v] = lowlink[v] = index++
    stack.push(v)
    onStack[v] = 1

    const neighbors = refs[v]
    if (neighbors) {
      for (const w of neighbors) {
        if (excluded[w]) continue
        if (indices[w] === -1) {
          strongconnect(w)
          if (lowlink[w]! < lowlink[v]!) lowlink[v] = lowlink[w]!
        } else if (onStack[w]) {
          if (indices[w]! < lowlink[v]!) lowlink[v] = indices[w]!
        }
      }
    }

    if (lowlink[v] === indices[v]) {
      const comp: number[] = []
      let w: number
      const compId = sccs.length
      do {
        w = stack.pop()!
        onStack[w] = 0
        sccId[w] = compId
        comp.push(w)
      } while (w !== v)
      sccs.push(comp)
    }
  }

  for (let v = 0; v < n; v++) {
    if (!excluded[v] && indices[v] === -1) strongconnect(v)
  }

  // Mark SCCs with any incoming edge from outside the SCC (among non-excluded bindings)
  const hasIncoming = new Uint8Array(sccs.length)
  for (let src = 0; src < n; src++) {
    if (excluded[src]) continue
    const srcId = sccId[src]!
    const neighbors = refs[src]
    if (neighbors) {
      for (const dst of neighbors) {
        if (excluded[dst]) continue
        const dstId = sccId[dst]!
        if (srcId !== dstId) hasIncoming[dstId] = 1
      }
    }
  }

  // Collect removable bindings from closed SCCs (cycles with no external references)
  const removable = new Set<Binding>()

  for (let compId = 0; compId < sccs.length; compId++) {
    const comp = sccs[compId]!
    // SCC with one binding: only removable if it references itself (e.g. recursive fn)
    if (comp.length === 1) {
      const idx = comp[0]!
      if (refs[idx]?.includes(idx)) removable.add(allBindings[idx]!)
      continue
    }

    // SCC with multiple bindings: removable if no binding outside the SCC references it
    if (!hasIncoming[compId]) {
      for (const idx of comp) removable.add(allBindings[idx]!)
    }
  }

  return removable
}

export function isLoopIteratorBinding(binding: Binding): boolean {
  if (binding.path.type === "VariableDeclarator") {
    const declPath = binding.path.parentPath
    if (
      declPath?.key === "left" &&
      (declPath.parent.type === "ForOfStatement" ||
        declPath.parent.type === "ForInStatement")
    ) {
      return true
    }
  }
  return false
}
