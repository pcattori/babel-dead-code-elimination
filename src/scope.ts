import { traverse, t, type NodePath, type Babel } from "./babel-esm"

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
