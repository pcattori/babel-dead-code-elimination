import { t, type NodePath, type Babel, type Binding } from "./babel-esm"
import { isRestFiltered } from "./pattern"

/**
 * Finds bindings that nothing elimination keeps can reach, through references
 * inside declarations.
 * @param isKept - Bindings that elimination keeps regardless of references.
 * Given exactly when elimination has candidates, which also keep every
 * pattern that was empty to begin with.
 */
export default function findRemovableBindings(
  programPath: NodePath<Babel.Program>,
  isKept?: (binding: Binding) => boolean,
): Set<Binding> {
  const graph = buildReferenceGraph(programPath, isKept, true)
  const removable = new Set<Binding>()
  if (!graph) return removable
  // Every binding left is reachable from nothing that elimination keeps, so it
  // is dead, whether it forms a cycle or is only referenced or reassigned by
  // dead code. Unreferenced ones are removed anyway, so only referenced or
  // reassigned ones are listed.
  const { bindings, excluded } = graph
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!
    if (
      !excluded[i] &&
      (isReferenced(binding) || binding.constantViolations.length > 0)
    ) {
      removable.add(binding)
    }
  }
  return removable
}

/**
 * Finds the bindings that nothing kept reaches and that no binding outside
 * their strongly connected component references: the members of closed dead
 * cycles (a self-recursive function counts), and bindings nothing references
 * at all. Reference collection leaves out the referenced ones among these,
 * so a binding read only by other dead code stays a candidate that a later
 * transform can make unreferenced. Keys filtered out of an object rest count
 * as kept here, as they always did for reference collection.
 */
export function findDeadCycleBindings(
  programPath: NodePath<Babel.Program>,
): Set<Binding> {
  const removable = new Set<Binding>()
  const graph = buildReferenceGraph(programPath, isRestFilteredBinding)
  if (!graph) return removable
  const { bindings, refs, excluded } = graph
  const n = bindings.length

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
  for (let compId = 0; compId < sccs.length; compId++) {
    // Removable only if no binding outside the SCC references it. The
    // referencing binding may be one that elimination keeps.
    if (hasIncoming[compId]) continue
    for (const idx of sccs[compId]!) removable.add(bindings[idx]!)
  }
  return removable
}

/**
 * The program's bindings, the references inside each one's declaration, and
 * which bindings are excluded: kept, read from outside every declaration, or
 * reached from such a binding. Undefined when every binding is excluded.
 * @param forElimination - Treat a reassignment inside a declaration like a
 * reference from it, so that it keeps the variable only while the declaration
 * is kept, and attribute a reference in a destructuring default or computed
 * key to the element it belongs to, which elimination removes with it.
 * Otherwise every reassigned binding is excluded and every reference inside
 * a declarator comes from all of its bindings, as reference collection always
 * did.
 */
function buildReferenceGraph(
  programPath: NodePath<Babel.Program>,
  isKept?: (binding: Binding) => boolean,
  forElimination = false,
):
  | { bindings: Binding[]; refs: (number[] | null)[]; excluded: Uint8Array }
  | undefined {
  // Babel keeps bindings in a dictionary-mode object, where Object.keys with
  // indexed reads is several times faster than Object.values.
  const bindingsByName = programPath.scope.bindings
  const names = Object.keys(bindingsByName)
  const allBindings = new Array<Binding>(names.length)
  for (let i = 0; i < names.length; i++) {
    allBindings[i] = bindingsByName[names[i]!]!
  }
  const n = allBindings.length
  if (n === 0) return undefined

  // if binding `a` is referenced inside binding `b`'s definition, refs[b] contains a
  // Map each declaration node to the bindings it declares for fast lookup when
  // tracing refs. A destructuring declarator declares several bindings.
  const pathNodeToIdx = new Map<Babel.Node, number[]>()
  const refs: (number[] | null)[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const node = allBindings[i]!.path.node
    const indices = pathNodeToIdx.get(node)
    if (indices) indices.push(i)
    else pathNodeToIdx.set(node, [i])
    refs[i] = null
  }

  // Mark bindings as excluded (not removable) if they have external refs or
  // reassignments, or are kept. A program-level loop head is a `var`, whose
  // loop assignment Babel records as a reassignment by its own declarator.
  const excluded = new Uint8Array(n)
  // excluded bindings whose refs need to be excluded too
  const exclusionQueue: number[] = []
  // bindings that might be removable
  let candidateCount = n

  // Adds an edge to `target` from every binding whose declaration contains
  // `site`. False when no declaration contains it.
  const addEdges = (site: NodePath, target: number): boolean => {
    let containers: number[] | undefined
    // The path from `site` up to the declaration, the declaration excluded.
    const chain: NodePath[] = []
    for (let path: NodePath | null = site; path; path = path.parentPath) {
      containers = pathNodeToIdx.get(path.node)
      if (containers !== undefined) break
      chain.push(path)
    }
    if (containers === undefined) return false
    // Every binding of a declarator keeps its initializer alive; a default or
    // computed key in its pattern only matters while its element stays.
    if (forElimination) {
      const owner = findOwningElement(chain)
      // Candidates keep every pattern that was empty to begin with, and so
      // the element or declarator that holds one (`{ a, k: {} = x } = y`):
      // its default or initializer is read from code that elimination keeps.
      const container = allBindings[containers[0]!]!.path.node
      if (
        isKept &&
        t.isVariableDeclarator(container) &&
        holdsEmptyPattern(owner?.element ?? container.id)
      ) {
        return false
      }
      if (owner !== undefined) {
        // The element's bindings, and the rests that keep it filtered out.
        // Without candidates, an element that binds nothing and that no rest
        // filters goes in this pass, and its reads with it.
        containers = containers.filter((idx) =>
          [owner.element, ...owner.rests].some((pattern) =>
            contains(pattern, allBindings[idx]!.identifier),
          ),
        )
      }
    }
    for (const containerIdx of containers) {
      const containerRefs = refs[containerIdx]
      if (!containerRefs) {
        refs[containerIdx] = [target]
        // Sites of one target are processed together, so any duplicate edge
        // is the last one appended to its containing declaration.
      } else if (containerRefs[containerRefs.length - 1] !== target) {
        containerRefs.push(target)
      }
    }
    return true
  }

  for (let i = 0; i < n; i++) {
    const binding = allBindings[i]!

    if (
      !isRemovableDeclaration(binding) ||
      isKept?.(binding) ||
      (binding.constantViolations.length > 0 &&
        (!forElimination || isLoopIteratorBinding(binding)))
    ) {
      excluded[i] = 1
      candidateCount--
      exclusionQueue.push(i)
      continue
    }

    // A reassignment, like a reference, keeps the binding alive only while
    // the declaration that contains it is kept. Only reached when following
    // reassignments: otherwise a reassigned binding is excluded above.
    const reachable =
      binding.constantViolations.every((site) => addEdges(site, i)) &&
      binding.referencePaths.every(
        (site) => isTypeOnlyReference(site) || addEdges(site, i),
      )
    if (!reachable) {
      excluded[i] = 1
      candidateCount--
      exclusionQueue.push(i)
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

  if (candidateCount === 0) return undefined
  return { bindings: allBindings, refs, excluded }
}

/**
 * The pattern element that owns a reference inside a declarator's id: the
 * target of the outermost default (`{ a = x }`, `[{ a, b } = x]`) or the
 * value of the outermost computed key (`{ [x]: a }`) that holds the
 * reference, with the rest arguments of the object patterns that filter the
 * element out (`{ a = x, ...rest }`). `chain` runs from the reference up to
 * the declarator's `id`, and holds at least the reference: a site is never a
 * declaration (loop heads, which Babel records as reassigned by their own
 * declarator, are excluded before). Undefined when the reference is in the
 * initializer.
 */
function findOwningElement(
  chain: NodePath[],
): { element: Babel.Node; rests: Babel.Node[] } | undefined {
  if (chain.at(-1)!.key !== "id") return undefined
  const rests: Babel.Node[] = []
  // A value inside a pattern sits in a default or a computed key (references
  // in its type annotation are type-only), so the loop returns before it
  // reaches the reference.
  for (let k = chain.length - 1; ; k--) {
    const node = chain[k]!.node
    const child = chain[k - 1]!.node
    if (t.isObjectPattern(node)) {
      const last = node.properties.at(-1)
      if (t.isRestElement(last) && last !== child) rests.push(last.argument)
    }
    if (t.isAssignmentPattern(node) && child === node.right)
      return { element: node.left, rests }
    if (t.isObjectProperty(node) && child === node.key)
      return { element: node.value, rests }
  }
}

/** Whether a pattern is or holds an empty object or array pattern. */
function holdsEmptyPattern(node: Babel.Node | null): boolean {
  if (t.isObjectPattern(node)) {
    return (
      node.properties.length === 0 ||
      // An object rest binds a name: its `value` is undefined.
      node.properties.some((property) =>
        holdsEmptyPattern((property as Babel.ObjectProperty).value),
      )
    )
  }
  if (t.isArrayPattern(node)) {
    return (
      node.elements.every((element) => element === null) ||
      node.elements.some(holdsEmptyPattern)
    )
  }
  if (t.isAssignmentPattern(node)) return holdsEmptyPattern(node.left)
  if (t.isRestElement(node)) return holdsEmptyPattern(node.argument)
  return false
}

/** Whether `identifier` is one of the names `pattern` binds. */
const contains = (pattern: Babel.Node, identifier: Babel.Identifier) =>
  t.getBindingIdentifiers(pattern)[identifier.name] === identifier

// Elimination only removes these declarations. Any other binding (such as a
// TypeScript enum) is kept and keeps everything it references alive.
function isRemovableDeclaration(binding: Binding): boolean {
  switch (binding.path.type) {
    case "ClassDeclaration":
      return !hasDefinitionSideEffects(
        binding.path as NodePath<Babel.ClassDeclaration>,
      )
    case "VariableDeclarator":
    case "FunctionDeclaration":
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

// Nodes whose child names a value only in a type: `typeof x`, `T<x.y>`,
// `implements x`, `interface I extends x`, and computed keys in types
// (`{ [x]: T }`, `{ [x.y](): T }`).
const TYPE_REFERENCE_PARENTS = new Set([
  "TSTypeQuery",
  "TSTypeReference",
  "TSExpressionWithTypeArguments",
  "TSInterfaceHeritage",
  "TSClassImplements",
  "TSPropertySignature",
  "TSMethodSignature",
])

/**
 * Babel counts the name of a same-named TypeScript type alias, interface or
 * overload signature, a name used in a type (`typeof x`, a computed key) and
 * a type-only export as a reference to a value binding. These disappear with
 * the types and never read the value.
 */
function isTypeOnlyReference(path: NodePath): boolean {
  // A reference is never the Program, so it always has a parent.
  let parent: NodePath = path.parentPath!
  if (
    path.key === "id" &&
    (parent.isTSTypeAliasDeclaration() ||
      parent.isTSInterfaceDeclaration() ||
      parent.isTSDeclareFunction())
  ) {
    return true
  }
  if (parent.isExportSpecifier()) return isTypeOnlyExport(parent)
  // Climb the dotted name the reference starts: `x.y` in a type is a
  // qualified name, and in a computed key a member expression.
  while (parent.isTSQualifiedName() || parent.isMemberExpression()) {
    parent = parent.parentPath!
  }
  return TYPE_REFERENCE_PARENTS.has(parent.type)
}

/** Whether an export specifier exports only a type: `export type { s }`, `export { type s }`. */
export function isTypeOnlyExport(
  specifier: NodePath<Babel.ExportSpecifier>,
): boolean {
  return (
    specifier.node.exportKind === "type" ||
    (specifier.parent as Babel.ExportNamedDeclaration).exportKind === "type"
  )
}

/** Whether code other than TypeScript declarations references the binding. */
export function isReferenced(binding: Binding): boolean {
  return (
    binding.referenced &&
    binding.referencePaths.some((path) => !isTypeOnlyReference(path))
  )
}

/**
 * Whether defining the class runs code whose effects removal would drop:
 * decorators (which commonly register the class), static blocks, impure
 * static initializers or computed keys, or an `extends` clause other than a
 * (dotted) name.
 */
export function hasDefinitionSideEffects(
  path: NodePath<Babel.ClassDeclaration>,
): boolean {
  const { node, scope } = path
  if (node.decorators?.length) return true
  if (node.superClass && !isName(node.superClass)) return true
  for (const member of node.body.body) {
    if (t.isStaticBlock(member)) return true
    if ("decorators" in member && member.decorators?.length) return true
    if ("computed" in member && member.computed && !scope.isPure(member.key)) {
      return true
    }
    if (
      (t.isClassProperty(member) ||
        t.isClassPrivateProperty(member) ||
        t.isClassAccessorProperty(member)) &&
      member.static &&
      member.value &&
      !scope.isPure(member.value)
    ) {
      return true
    }
    if (
      (t.isClassMethod(member) || t.isTSDeclareMethod(member)) &&
      member.params.some((param) => param.decorators?.length)
    ) {
      return true
    }
  }
  return false
}

const isName = (node: Babel.Node): boolean =>
  t.isIdentifier(node) ||
  (t.isMemberExpression(node) && !node.computed && isName(node.object))

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
