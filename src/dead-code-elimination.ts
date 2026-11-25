import {
  t,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import * as Pattern from "./pattern"
import { forEachMatchingPath, getProgramPath } from "./walk"
import {
  crawlProgram,
  isAttached,
  mustCrawlProgram,
  refreshBindings,
  snapshotBindings,
  type BindingSnapshot,
} from "./scope"
import findRemovableBindings, {
  getDeclaredBinding,
  hasDefinitionSideEffects,
  isLoopIteratorBinding,
  isReferenced,
  isTypeOnlyExport,
  redeclarations,
} from "./find-removable-bindings"

const ELIMINATION_TYPES = new Set([
  "ImportDeclaration",
  "VariableDeclarator",
  "ObjectPattern",
  "ArrayPattern",
  "FunctionDeclaration",
  "ClassDeclaration",
])

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<Babel.File>,
  candidates?: Set<NodePath<Babel.Identifier>>,
) {
  let needsAnotherPass = false
  let programPath!: NodePath<Babel.Program>
  const paths: Array<NodePath> = []

  // Bindings that nothing elimination keeps reaches
  let removableBindings: Set<Binding>
  let snapshot: BindingSnapshot | undefined

  // Candidates are matched by node: a transform that rebuilds a declaration
  // around its own id node gives the id a new path, but it stays a candidate.
  let candidateNodes: Set<Babel.Node> | undefined
  if (candidates !== undefined) {
    candidateNodes = new Set()
    for (const candidate of candidates) candidateNodes.add(candidate.node)
  }
  const hasCandidates = candidateNodes !== undefined
  // Elimination keeps bindings outside the candidate set, so they must keep
  // everything they reference alive, including members of reference cycles.
  const isKept = candidateNodes
    ? (binding: Binding) => !candidateNodes.has(binding.identifier)
    : undefined
  // Patterns that elimination emptied. With candidates, a pattern that was
  // empty to begin with (`const {} = init()`) is kept with its initializer.
  const emptied = new WeakSet<Babel.Node>()
  const markEmptied = (path: NodePath) => {
    for (
      let p = path.parentPath;
      p && !p.isVariableDeclarator();
      p = p.parentPath
    ) {
      if (p.isObjectPattern() || p.isArrayPattern()) emptied.add(p.node)
    }
  }
  const shouldBeRemoved = (ident: NodePath<Babel.Identifier>): boolean => {
    if (candidateNodes && !candidateNodes.has(ident.node)) return false

    const binding = getDeclaredBinding(ident)

    // A `var` redeclaration goes with the declaration that made the binding.
    if (
      binding &&
      redeclarations(binding).some((r) => r.node.id === ident.node)
    )
      return false

    // Only remove a declaration whose own binding is known. Removing a sole
    // declarator also removes its declaration, and Babel deletes the name
    // from scope for both, so the second deletion can drop a same-named
    // binding of an enclosing scope until the bindings are refreshed. Such a
    // declaration is decided in another pass.
    if (binding?.identifier !== ident.node) {
      needsAnotherPass = true
      return false
    }

    // If nothing that elimination keeps reaches the binding, allow removal
    if (removableBindings.has(binding)) return true

    if (isReferenced(binding)) return false

    // Preserve bindings with constant violations (assignments like x = 2)
    if (binding.constantViolations.length > 0) return false

    // Preserve loop iterator bindings (for...of, for...in)
    if (isLoopIteratorBinding(binding)) return false

    return true
  }

  // Call before removing anything but imports. Such a removal can make Babel
  // drop unrelated bindings by name, so bindings are recorded before the first
  // one. Whether it can let another pass remove more is decided after the pass,
  // from the references it dropped (see refreshBindings).
  let removedAny = false
  const willRemove = (): void => {
    removedAny = true
    snapshot ??= snapshotBindings(programPath)
  }
  // Call when a removal changes a pattern without dropping a reference: an
  // emptied enclosing pattern, or keys no longer filtered out of a rest.
  const reshapedPattern = (): void => {
    needsAnotherPass = true
  }

  const visit = (path: NodePath): void => {
    if (path.isImportDeclaration()) {
      // Imports contain no references to other local bindings, so removing
      // them cannot make another declaration dead or require another pass.
      if (path.node.specifiers.length === 0) {
        return
      }
      let removedValue = false
      for (let specifier of path.get("specifiers")) {
        let local = specifier.get("local")
        if (shouldBeRemoved(local)) {
          specifier.remove()
          removedValue = true
        }
      }
      // An import left with only type specifiers would still load its module
      // where types are kept as imports (`verbatimModuleSyntax` emits
      // `import {} from "./db.server"`), so it goes with its last value.
      const node = path.node
      if (
        node.specifiers.length === 0 ||
        (removedValue &&
          node.specifiers.every(
            (specifier) =>
              node.importKind === "type" ||
              (specifier.type === "ImportSpecifier" &&
                specifier.importKind === "type"),
          ))
      ) {
        path.remove()
      }
      return
    }
    if (path.isVariableDeclarator()) {
      let id = path.get("id")
      if (id.isIdentifier()) {
        if (shouldBeRemoved(id) && !callsInFunction(path)) {
          willRemove()
          const again = redeclarations(getDeclaredBinding(id)!)
          path.remove()
          for (const redeclaration of again) redeclaration.remove()
        }
      } else {
        // A parsed declarator binds an identifier or a pattern.
        const pattern = id as NodePath<Babel.ObjectPattern | Babel.ArrayPattern>
        for (let variable of Pattern.findVariables(pattern)) {
          // Keep unused variables that are filtered out of an object rest: in
          // `let { a, ...rest } = ...`, removing `a` would add it to `rest`.
          // This includes defaults and nested patterns, and takes precedence
          // over removable cycles.
          if (Pattern.isRestFiltered(pattern.node, variable.node)) continue
          if (!shouldBeRemoved(variable)) continue
          if (callsInFunction(path)) break
          markEmptied(variable)
          willRemove()
          // Keys that a removed rest no longer filters out may now go.
          if (variable.parentPath.isRestElement()) reshapedPattern()
          Pattern.remove(variable)
        }
      }
      return
    }
    if (path.isObjectPattern() || path.isArrayPattern()) {
      const node = path.node
      const isEmpty = t.isObjectPattern(node)
        ? node.properties.length === 0
        : node.elements.every((element) => element === null)
      if (!isEmpty) return
      let declarator = Pattern.findDeclarator(path)
      if (
        declarator &&
        !Pattern.isRestFiltered(declarator.node.id, node) &&
        !callsInFunction(declarator) &&
        (!hasCandidates || emptied.has(node))
      ) {
        willRemove()
        // Removing a nested pattern can empty the pattern that holds it.
        if (!t.isVariableDeclarator(path.parent)) reshapedPattern()
        Pattern.remove(path)
      }
      return
    }
    if (path.isFunctionDeclaration()) {
      let id = path.get("id")
      if (id.isIdentifier() && shouldBeRemoved(id)) {
        willRemove()
        // TypeScript overload signatures cannot outlive their implementation.
        for (let sibling of path.getAllPrevSiblings()) {
          if (
            sibling.isTSDeclareFunction() &&
            sibling.node.id!.name === id.node.name
          ) {
            sibling.remove()
          }
        }
        path.remove()
      }
      return
    }
    // Only the declaration types in ELIMINATION_TYPES reach visit, so this
    // is a class declaration.
    const classPath = path as NodePath<Babel.ClassDeclaration>
    let id = classPath.get("id")
    if (id.isIdentifier() && shouldBeRemoved(id) && !runsCode(classPath)) {
      willRemove()
      classPath.remove()
    }
  }

  // Whether defining a class runs code is decided once, before anything is
  // removed: once a name the class reads is removed, Babel would judge the
  // read as one of a global, which may throw.
  const classRunsCode = new Map<Babel.Node, boolean>()
  const runsCode = (path: NodePath<Babel.ClassDeclaration>): boolean => {
    let result = classRunsCode.get(path.node)
    if (result === undefined) {
      result = hasDefinitionSideEffects(path)
      classRunsCode.set(path.node, result)
    }
    return result
  }

  const crawl = mustCrawlProgram(ast)
  programPath = getProgramPath(ast)
  if (crawl) crawlProgram(programPath)
  removableBindings = findRemovableBindings(programPath, isKept, runsCode)
  const typeExports = findTypeOnlyExports(programPath)
  // Collect the declaration and pattern paths in source order without a Babel
  // traversal (see walk.ts).
  forEachMatchingPath(
    programPath,
    (node) => ELIMINATION_TYPES.has(node.type),
    (path) => {
      paths.push(path)
      if (path.isClassDeclaration()) runsCode(path)
    },
  )

  // Elimination only removes nodes. Revisit the declaration paths in source
  // order, without traversing unchanged expressions on every pass, and update
  // the bindings instead of crawling the program again.
  for (;;) {
    for (const path of paths) {
      if (isAttached(path)) {
        visit(path)
      }
    }
    if (!removedAny) break
    removedAny = false
    // Refresh even when no pass follows, so the bindings match the output.
    const lostReference = refreshBindings(snapshot!)
    if (!needsAnotherPass && !lostReference) break
    needsAnotherPass = false
    removableBindings = findRemovableBindings(programPath, isKept, runsCode)
  }

  // A type-only export keeps no value alive, but once the value is gone it
  // names nothing, which TypeScript parsers reject. It stays while a type of
  // that name does (`type s = ...` next to `const s`).
  for (const { specifier, binding } of typeExports) {
    if (programPath.scope.bindings[binding.identifier.name] === binding)
      continue
    if (binding.referencePaths.some(isSameNamedType)) continue
    const declaration =
      specifier.parentPath as NodePath<Babel.ExportNamedDeclaration>
    specifier.remove()
    if (declaration.node.specifiers.length === 0) declaration.remove()
  }
}

/** Top-level type-only export specifiers of local bindings, with their binding. */
function findTypeOnlyExports(programPath: NodePath<Babel.Program>) {
  const result: Array<{
    specifier: NodePath<Babel.ExportSpecifier>
    binding: Binding
  }> = []
  programPath.node.body.forEach((statement, i) => {
    if (statement.type !== "ExportNamedDeclaration" || statement.source) return
    if (statement.specifiers.length === 0) return
    const path = programPath.get(
      `body.${i}`,
    ) as NodePath<Babel.ExportNamedDeclaration>
    for (const specifier of path.get("specifiers")) {
      if (!specifier.isExportSpecifier() || !isTypeOnlyExport(specifier))
        continue
      const binding = programPath.scope.bindings[specifier.node.local.name]
      if (binding) result.push({ specifier, binding })
    }
  })
  return result
}

/** Whether a reference is the name of a same-named type alias or interface. */
const isSameNamedType = (path: NodePath): boolean =>
  path.key === "id" &&
  (path.parent.type === "TSTypeAliasDeclaration" ||
    path.parent.type === "TSInterfaceDeclaration")

/**
 * Whether a declarator inside a function evaluates a call when its initializer
 * runs, directly or nested (`useId()`, `useCtx().value`, `c ? useA() : 0`,
 * `[useA()]`), but not in a nested function (`() => useA()` runs nothing).
 * Such calls run on every invocation, and some must run in the same order in
 * every build: removing an unused `const id = useId()` from a component only in
 * the server build shifts React's hook-based ids. Declarations like these are
 * kept even when their bindings are unused.
 */
function callsInFunction(path: NodePath<Babel.VariableDeclarator>): boolean {
  return path.getFunctionParent() !== null && evaluatesCall(path.node.init)
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
