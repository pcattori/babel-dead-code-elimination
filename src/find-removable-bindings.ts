import { t, type NodePath, type Babel, type Binding } from "./babel-esm"
import { isRestFiltered } from "./pattern"

/**
 * Finds bindings forming closed SCCs with no external references.
 * @param isKept - Bindings that elimination keeps regardless of references.
 */
export default function findRemovableBindings(
  programPath: NodePath<Babel.Program>,
  isKept?: (binding: Binding) => boolean,
): Set<Binding> {
  const allBindings = Object.values(programPath.scope.bindings)
  const n = allBindings.length
  if (n === 0) return new Set()

  // Build a graph of bindings for cycle detection (Tarjan's algorithm)
  // if binding `a` is referenced inside binding `b`'s definition, refs[b] contains a
  // Map each declaration node to the bindings it declares for fast lookup when
  // tracing refs. A destructuring declarator declares several bindings.
  const pathNodeToIdx = new Map<Babel.Node, number[]>()
  const refs: (number[] | null)[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const node = allBindings[i]!.path?.node
    if (node) {
      const indices = pathNodeToIdx.get(node)
      if (indices) indices.push(i)
      else pathNodeToIdx.set(node, [i])
    }
    refs[i] = null
  }

  // Mark bindings as excluded (not removable) if they have external refs, reassignments, are loop iterators, or are kept
  const excluded = new Uint8Array(n)
  // excluded bindings whose refs need to be excluded too
  const exclusionQueue: number[] = []
  // bindings that might be removable
  let candidateCount = n

  for (let i = 0; i < n; i++) {
    const binding = allBindings[i]!

    if (
      binding.constantViolations.length > 0 ||
      isLoopIteratorBinding(binding) ||
      !isRemovableDeclaration(binding) ||
      isRestFilteredBinding(binding) ||
      isKept?.(binding)
    ) {
      excluded[i] = 1
      candidateCount--
      exclusionQueue.push(i)
      continue
    }

    for (const refPath of binding.referencePaths) {
      // Walk up the AST to find which binding (if any) contains this reference
      let path: NodePath | null = refPath
      let containers: number[] | undefined
      while (path) {
        containers = pathNodeToIdx.get(path.node)
        if (containers !== undefined) break
        path = path.parentPath
      }
      if (containers !== undefined) {
        // Every binding of a declarator keeps its initializer alive.
        for (const containerIdx of containers) {
          const containerRefs = refs[containerIdx]
          if (!containerRefs) {
            refs[containerIdx] = [i]
            // References to this target are processed together, so any duplicate
            // edge is the last one appended to its containing declaration.
          } else if (containerRefs[containerRefs.length - 1] !== i) {
            containerRefs.push(i)
          }
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

  // Tarjan's SCC algorithm finds cycles. Small candidate sets are not
  // special-cased: hand-written checks missed cycles such as a<->c, b<->c.
  const indices = new Int32Array(n).fill(-1)
  const lowlink = new Int32Array(n)
  const onStack = new Uint8Array(n)
  const stack: number[] = []
  const sccs: number[][] = []
  const sccId = new Int32Array(n).fill(-1)
  let index = 0
  // Iterative depth-first search: reference chains can be longer than the
  // call stack allows. edgeCursor[v] is the next neighbor of v to explore.
  const callStack: number[] = []
  const edgeCursor = new Int32Array(n)

  const visit = (v: number): void => {
    indices[v] = lowlink[v] = index++
    stack.push(v)
    onStack[v] = 1
    callStack.push(v)
  }

  for (let root = 0; root < n; root++) {
    if (excluded[root] || indices[root] !== -1) continue
    visit(root)
    while (callStack.length > 0) {
      const v = callStack[callStack.length - 1]!
      const neighbors = refs[v]
      const edge = edgeCursor[v]!
      if (neighbors && edge < neighbors.length) {
        edgeCursor[v] = edge + 1
        const w = neighbors[edge]!
        if (excluded[w]) continue
        if (indices[w] === -1) {
          visit(w)
        } else if (onStack[w]) {
          if (indices[w]! < lowlink[v]!) lowlink[v] = indices[w]!
        }
        continue
      }

      callStack.pop()
      const parent = callStack[callStack.length - 1]
      if (parent !== undefined && lowlink[v]! < lowlink[parent]!) {
        lowlink[parent] = lowlink[v]!
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
    // Removable only if no binding outside the SCC references it. The
    // referencing binding may be one that elimination keeps.
    if (hasIncoming[compId]) continue
    const comp = sccs[compId]!
    // SCC with one binding: only a cycle if it references itself (e.g. recursive fn)
    if (comp.length === 1 && !refs[comp[0]!]?.includes(comp[0]!)) continue
    for (const idx of comp) removable.add(allBindings[idx]!)
  }

  return removable
}

// Elimination only removes these declarations. Any other binding (such as a
// TypeScript enum) is kept and keeps everything it references alive.
function isRemovableDeclaration(binding: Binding): boolean {
  switch (binding.path.type) {
    case "VariableDeclarator":
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return true
  }
  return false
}

// Elimination keeps object pattern properties that are filtered out of a rest
// element, even when they are unused.
function isRestFilteredBinding(binding: Binding): boolean {
  const declarator = binding.path.node
  return (
    t.isVariableDeclarator(declarator) &&
    isRestFiltered(declarator.id, binding.identifier)
  )
}

/** Resolves the binding that a declaration's identifier declares. */
export function getDeclaredBinding(
  ident: NodePath<Babel.Identifier>,
): Binding | undefined {
  // A function declaration's id belongs to the enclosing scope. Its path's
  // scope is the function's own scope, where a parameter can shadow the name.
  const scope =
    ident.key === "id" && ident.parentPath.isFunctionDeclaration()
      ? ident.parentPath.scope.parent
      : ident.scope
  return scope.getBinding(ident.node.name)
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
