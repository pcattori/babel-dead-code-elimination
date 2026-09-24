import {
  traverse,
  t,
  type NodePath,
  type Babel,
  type Binding,
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
  /** Other program bindings (e.g. TypeScript enums), which are never removed. */
  retained: Array<[string, Binding]>
}

/** Records the bindings of a program. Call after a crawl, before removals. */
export function snapshotBindings(
  programPath: NodePath<Babel.Program>,
): BindingSnapshot {
  const declared: BindingSnapshot["declared"] = []
  const declaredBindings = new Set<Binding>()
  forEachMatchingPath(
    programPath,
    (node) => DECLARATION_TYPES.has(node.type),
    (path) =>
      forEachDeclaredIdentifier(path, (identifier) => {
        const binding = getDeclaredBinding(identifier)
        if (binding?.identifier === identifier.node) {
          declared.push({ identifier, binding })
          declaredBindings.add(binding)
        }
      }),
  )
  const retained: BindingSnapshot["retained"] = []
  for (const name of Object.keys(programPath.scope.bindings)) {
    const binding = programPath.scope.bindings[name]!
    if (!declaredBindings.has(binding)) retained.push([name, binding])
  }
  return { programPath, declared, retained }
}

/**
 * Updates the snapshot's bindings to what a crawl of the current AST would
 * produce, after elimination removed nodes: references and constant
 * violations in removed code are dropped, removed declarations leave their
 * scope, and bindings that Babel deleted by name while removing a same-named
 * declaration elsewhere are registered again.
 */
export function refreshBindings(snapshot: BindingSnapshot): void {
  for (const { identifier, binding } of snapshot.declared) {
    const bindings = binding.scope.bindings
    const name = identifier.node.name
    if (!isAttached(identifier)) {
      if (bindings[name] === binding) delete bindings[name]
      continue
    }
    bindings[name] = binding
    dropRemovedPaths(binding)
  }
  const bindings = snapshot.programPath.scope.bindings
  for (const [name, binding] of snapshot.retained) {
    bindings[name] = binding
    dropRemovedPaths(binding)
  }
}

function dropRemovedPaths(binding: Binding): void {
  binding.referencePaths = binding.referencePaths.filter(isAttached)
  binding.references = binding.referencePaths.length
  binding.referenced = binding.references > 0
  binding.constantViolations = binding.constantViolations.filter(isAttached)
  binding.constant = binding.constantViolations.length === 0
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
