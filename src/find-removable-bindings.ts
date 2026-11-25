import { t, type NodePath, type Babel, type Binding } from "./babel-esm"

/**
 * Finds the bindings of a scope that nothing elimination keeps can reach,
 * through references inside the scope's declarations. The scope is the
 * program's, a function's or a block's: locals that only read each other are
 * as dead as such module declarations (decision R2-D5).
 * @param scopePath - A path whose scope is the one to analyze.
 * @param isKept - Bindings that elimination keeps regardless of references.
 * Given exactly when elimination has candidates, which also keep every
 * pattern that was empty to begin with.
 * @param classRunsCode - Whether defining a class runs code. Elimination
 * decides it before removing anything (see hasDefinitionSideEffects).
 */
export default function findRemovableBindings(
  scopePath: NodePath,
  isKept?: (binding: Binding) => boolean,
  classRunsCode: ClassRunsCode = hasDefinitionSideEffects,
): Set<Binding> {
  const graph = buildReferenceGraph(scopePath, isKept, true, classRunsCode)
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
 * transform can make unreferenced. A key filtered out of an object rest is
 * kept by the rest, so it counts as used only while the rest does. As in
 * elimination, a default or computed key is read by its own element and a
 * reassignment counts as a reference from the code doing it, so an element
 * that only its own default reads, or a variable that only code it keeps
 * reassigns, is in a closed cycle.
 */
export function findDeadCycleBindings(scopePath: NodePath): Set<Binding> {
  const removable = new Set<Binding>()
  const graph = buildReferenceGraph(scopePath)
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
          lowlink[v] = Math.min(lowlink[v]!, indices[w]!)
        }
        continue
      }

      callStack.pop()
      const parent = callStack[callStack.length - 1]
      if (parent !== undefined) {
        lowlink[parent] = Math.min(lowlink[parent]!, lowlink[v]!)
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
 * A reassignment inside a declaration counts like a reference from it, so
 * that it keeps the variable only while the declaration is kept, and a
 * reference in a destructuring default or computed key comes from the element
 * it belongs to and the rests that filter that element out, since elimination
 * removes it with the element.
 * @param forElimination - Elimination's graph: with candidates, an
 * already-empty pattern keeps what its declarator reads, and an element that
 * binds nothing lends its reads to no binding. Reference collection, without
 * candidates, lets such an element's reads come from the whole declarator, as
 * it always did.
 */
function buildReferenceGraph(
  scopePath: NodePath,
  isKept?: (binding: Binding) => boolean,
  forElimination = false,
  classRunsCode: ClassRunsCode = hasDefinitionSideEffects,
):
  | { bindings: Binding[]; refs: (number[] | null)[]; excluded: Uint8Array }
  | undefined {
  // Babel keeps bindings in a dictionary-mode object, where Object.keys with
  // indexed reads is several times faster than Object.values.
  const bindingsByName = scopePath.scope.bindings
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
    // A `var` redeclaration declares the same binding again: what it reads
    // and its own reassignment come from that binding.
    for (const redeclaration of redeclarations(allBindings[i]!))
      pathNodeToIdx.set(redeclaration.node, [i])
  }

  // Reference collection: a kept rest keeps the keys listed before it, which
  // count as used only while the rest does. Elimination keeps those keys
  // itself while the rest stays.
  if (!forElimination) {
    const indexOf = new Map<Binding, number>()
    for (let i = 0; i < n; i++) indexOf.set(allBindings[i]!, i)
    for (let i = 0; i < n; i++) {
      const binding = allBindings[i]!
      const declarator = binding.path.node
      if (!t.isVariableDeclarator(declarator)) continue
      // A declarator's binding names one of its identifiers.
      for (const rest of filteringRests(declarator.id, binding.identifier)!) {
        const name = (rest as Babel.Identifier).name
        ;(refs[indexOf.get(bindingsByName[name]!)!] ??= []).push(i)
      }
    }
  }

  // Mark bindings as excluded (not removable) if they have external refs or
  // reassignments, or are kept: by candidates, as loop heads, or as locals
  // whose declarator calls something when it runs (see callsInFunction).
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
    const owner = findOwningElement(chain)
    // Candidates keep every pattern that was empty to begin with, and so the
    // element or declarator that holds one (`{ a, k: {} = x } = y`): its
    // default or initializer is read from code that elimination keeps.
    const container = allBindings[containers[0]!]!.path.node
    if (
      forElimination &&
      isKept &&
      t.isVariableDeclarator(container) &&
      holdsEmptyPattern(owner?.element ?? container.id)
    ) {
      return false
    }
    if (
      owner !== undefined &&
      (forElimination || !bindsNothing(owner.element))
    ) {
      // The element's bindings, and the rests that keep it filtered out.
      // Without candidates, elimination removes an element that binds nothing
      // and that no rest filters in this pass, and its reads with it.
      containers = containers.filter((idx) =>
        [owner.element, ...owner.rests].some((pattern) =>
          contains(pattern, allBindings[idx]!.identifier),
        ),
      )
    }
    for (const containerIdx of containers) {
      const containerRefs = refs[containerIdx]
      if (!containerRefs) {
        refs[containerIdx] = [target]
        // Sites of one target are processed together, so a duplicate edge
        // from a site is the last one appended to its containing declaration
        // (a rest's edges to its keys may repeat one; a repeat is harmless).
      } else if (containerRefs[containerRefs.length - 1] !== target) {
        containerRefs.push(target)
      }
    }
    return true
  }

  for (let i = 0; i < n; i++) {
    const binding = allBindings[i]!

    if (
      !isRemovableDeclaration(binding, classRunsCode) ||
      isKept?.(binding) ||
      isLoopIteratorBinding(binding) ||
      (binding.path.isVariableDeclarator() && callsInFunction(binding.path))
    ) {
      excluded[i] = 1
      candidateCount--
      exclusionQueue.push(i)
      continue
    }

    // A reassignment, like a reference, keeps the binding alive only while
    // the declaration that contains it is kept.
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
 * the declarator's `id`; it is empty when the site is the declaration itself,
 * a `var` redeclaration. Undefined when the site is not in the id.
 */
function findOwningElement(
  chain: NodePath[],
): { element: Babel.Node; rests: Babel.Node[] } | undefined {
  if (chain.at(-1)?.key !== "id") return undefined
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

const bindsNothing = (pattern: Babel.Node) =>
  Object.keys(t.getBindingIdentifiers(pattern)).length === 0

/** Whether `identifier` is one of the names `pattern` binds. */
const contains = (pattern: Babel.Node, identifier: Babel.Identifier) =>
  t.getBindingIdentifiers(pattern)[identifier.name] === identifier

// Elimination only removes these declarations. Any other binding (such as a
// TypeScript enum) is kept and keeps everything it references alive.
function isRemovableDeclaration(
  binding: Binding,
  classRunsCode: ClassRunsCode,
): boolean {
  switch (binding.path.type) {
    case "ClassDeclaration":
      return !classRunsCode(binding.path as NodePath<Babel.ClassDeclaration>)
    case "VariableDeclarator":
    case "FunctionDeclaration":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return true
  }
  return false
}

/**
 * The rest arguments of the object patterns in `node` that filter `target`
 * out (`{ a, ...rest }` for `a`), or undefined when `target` is not in `node`.
 */
function filteringRests(
  node: Babel.Node | null | undefined,
  target: Babel.Node,
  rests: Babel.Node[] = [],
): Babel.Node[] | undefined {
  if (!node) return undefined
  if (node === target) return rests
  if (t.isObjectPattern(node)) {
    const last = node.properties.at(-1)
    const inner = t.isRestElement(last) ? [...rests, last.argument] : rests
    for (const property of node.properties) {
      const result = t.isRestElement(property)
        ? filteringRests(property.argument, target, rests)
        : filteringRests(property.value, target, inner)
      if (result) return result
    }
    return undefined
  }
  if (t.isArrayPattern(node)) {
    for (const element of node.elements) {
      const result = filteringRests(element, target, rests)
      if (result) return result
    }
    return undefined
  }
  if (t.isAssignmentPattern(node))
    return filteringRests(node.left, target, rests)
  if (t.isRestElement(node)) return filteringRests(node.argument, target, rests)
  return undefined
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

export type ClassRunsCode = (path: NodePath<Babel.ClassDeclaration>) => boolean

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

/**
 * The statements that declare a `var` binding again with a plain name
 * (`var x = a; var x`), which elimination removes with the binding.
 */
export function redeclarations(
  binding: Binding,
): NodePath<Babel.VariableDeclarator>[] {
  if (binding.kind !== "var" || !binding.path.isVariableDeclarator()) return []
  return binding.constantViolations.filter(
    (path): path is NodePath<Babel.VariableDeclarator> =>
      path.isVariableDeclarator() &&
      t.isIdentifier(path.node.id) &&
      path.parentPath.listKey === "body",
  )
}

export function isLoopIteratorBinding(binding: Binding): boolean {
  // Only a for-in or for-of head holds a declaration under the key `left`.
  return (
    binding.path.isVariableDeclarator() &&
    binding.path.parentPath.key === "left"
  )
}

/**
 * Whether a declarator inside a function evaluates a call when it runs, in its
 * initializer or in its pattern's defaults and computed keys, directly or
 * nested (`useId()`, `useCtx().value`, `c ? useA() : 0`, `[useA()]`,
 * `{ id = useId() }`, `{ [useKey()]: a }`), but not in a nested function
 * (`() => useA()` runs nothing). Such calls run on every invocation, and some
 * must run in the same order in every build: removing an unused
 * `const id = useId()` from a component only in the server build shifts
 * React's hook-based ids. Declarations like these are kept even when their
 * bindings are unused.
 */
export function callsInFunction(
  path: NodePath<Babel.VariableDeclarator>,
): boolean {
  return (
    path.getFunctionParent() !== null &&
    (evaluatesCall(path.node.init) || evaluatesCall(path.node.id))
  )
}

function evaluatesCall(node: Babel.Node | null | undefined): boolean {
  if (!node || t.isFunction(node)) return false
  if (
    t.isCallExpression(node) ||
    t.isOptionalCallExpression(node) ||
    t.isNewExpression(node) ||
    t.isTaggedTemplateExpression(node)
  ) {
    return true
  }
  for (const key of t.VISITOR_KEYS[node.type]!) {
    const child = (node as unknown as Record<string, unknown>)[key]
    if (
      Array.isArray(child)
        ? child.some((element) => evaluatesCall(element as Babel.Node | null))
        : evaluatesCall(child as Babel.Node | null)
    ) {
      return true
    }
  }
  return false
}
