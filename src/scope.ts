import {
  traverse,
  t,
  type NodePath,
  type Babel,
  type Binding,
  type Scope,
} from "./babel-esm"
import { DECLARATION_TYPES, forEachDeclaredIdentifier } from "./declarations"
import { getDeclaredBinding } from "./find-removable-bindings"
import { forEachMatchingPath } from "./walk"

/**
 * Rebuilds all scopes of a program from its current AST. Babel's Program crawl
 * keeps nested scopes that were already initialized, so their bindings would
 * still count references from removed code. Forgetting them makes the crawl
 * create fresh nested scopes.
 */
export function crawlProgram(programPath: NodePath<Babel.Program>): void {
  forgetNestedScopes(programPath.node)
  programPath.scope.crawl()
}

/**
 * Prepares a traversal of `ast` that needs scopes matching the current AST.
 * Returns whether the traversal must still call crawlProgram. When Babel has
 * no Program scope cached, the traversal creates one and Babel crawls it on
 * creation, so a second crawl would repeat identical work. Nested scopes are
 * forgotten first so that this crawl rebuilds them, too.
 */
export function mustCrawlProgram(ast: Babel.File): boolean {
  if (traverse.cache.scope.has(ast.program)) return true
  forgetNestedScopes(ast.program)
  return false
}

function forgetNestedScopes(program: Babel.Program): void {
  t.traverseFast(program, (node) => {
    if (node !== program) traverse.cache.scope.delete(node)
  })
}

/**
 * The bindings of a program right after a crawl. Elimination only removes
 * nodes, so refreshBindings can bring these bindings up to date afterwards
 * without crawling again.
 */
export type BindingSnapshot = {
  programPath: NodePath<Babel.Program>
  /** Bindings of the declarations elimination considers, in all scopes. */
  declared: Array<{ identifier: NodePath<Babel.Identifier>; binding: Binding }>
  /**
   * Bindings no declaration elimination considers makes, with their scope:
   * parameters, catch parameters, the own name of a function or class
   * expression, and program bindings such as Babel 8's TypeScript enums.
   * Elimination never removes them, but Babel may delete them by name.
   */
  retained: Array<[Scope, string, Binding]>
}

/** Nodes whose scope holds bindings that no declaration makes. */
const SCOPE_OWNER_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "CatchClause",
  "ClassExpression",
])

/** Records the bindings of a program. Call after a crawl, before removals. */
export function snapshotBindings(
  programPath: NodePath<Babel.Program>,
): BindingSnapshot {
  const declared: BindingSnapshot["declared"] = []
  const declaredBindings = new Set<Binding>()
  const owners: Scope[] = [programPath.scope]
  forEachMatchingPath(
    programPath,
    (node) =>
      DECLARATION_TYPES.has(node.type) || SCOPE_OWNER_TYPES.has(node.type),
    (path) => {
      if (SCOPE_OWNER_TYPES.has(path.node.type)) owners.push(path.scope)
      if (!DECLARATION_TYPES.has(path.node.type)) return
      forEachDeclaredIdentifier(path, (identifier) => {
        const binding = getDeclaredBinding(identifier)
        if (binding?.identifier === identifier.node) {
          declared.push({ identifier, binding })
          declaredBindings.add(binding)
        }
      })
    },
  )
  const retained: BindingSnapshot["retained"] = []
  for (const scope of owners) {
    for (const name of Object.keys(scope.bindings)) {
      const binding = scope.bindings[name]!
      if (!declaredBindings.has(binding)) retained.push([scope, name, binding])
    }
  }
  return { programPath, declared, retained }
}

/**
 * Updates the snapshot's bindings to what a crawl of the current AST would
 * produce, after elimination removed nodes: references and constant
 * violations in removed code are dropped, removed declarations leave their
 * scope, and bindings that Babel deleted by name while removing a same-named
 * declaration elsewhere are registered again. Returns whether a declaration
 * that is still there lost a reference or became constant: only then can
 * another pass remove more. Losing any reference counts, not only the last:
 * in `function f() { return f() }; const [] = g(f)`, removing the empty
 * pattern drops the only reference to `f` from outside the cycle.
 */
export function refreshBindings(snapshot: BindingSnapshot): boolean {
  let lost = false
  for (const { identifier, binding } of snapshot.declared) {
    const bindings = binding.scope.bindings
    const name = identifier.node.name
    if (!isAttached(identifier)) {
      // Each scope binds a name once, so this is the removed binding or
      // nothing Babel left.
      delete bindings[name]
      continue
    }
    bindings[name] = binding
    if (dropRemovedPaths(binding)) lost = true
  }
  // A retained binding is never removed on its own, so a reference it lost
  // cannot let another pass remove more. It goes only with the function or
  // class that holds it.
  for (const [scope, name, binding] of snapshot.retained) {
    if (!isAttached(binding.path)) continue
    scope.bindings[name] = binding
    dropRemovedPaths(binding)
  }
  return lost
}

/** Drops removed paths, and returns whether the binding lost a reference or became constant. */
function dropRemovedPaths(binding: Binding): boolean {
  const references = binding.referencePaths.length
  const wasConstant = binding.constantViolations.length === 0
  binding.referencePaths = binding.referencePaths.filter(isAttached)
  binding.references = binding.referencePaths.length
  binding.referenced = binding.references > 0
  binding.constantViolations = binding.constantViolations.filter(isAttached)
  binding.constant = binding.constantViolations.length === 0
  return (
    binding.referencePaths.length < references ||
    (!wasConstant && binding.constant)
  )
}

// Babel removal clears the removed path, not its descendants. Pattern cleanup
// also writes array holes directly. These are the only structural edits
// elimination makes.
export function isAttached(path: NodePath): boolean {
  for (
    let current: NodePath | null = path;
    current;
    current = current.parentPath
  ) {
    if (!current.node) {
      return false
    }
    if (
      Array.isArray(current.container) &&
      current.container[current.key as number] !== current.node
    ) {
      return false
    }
  }
  return true
}
