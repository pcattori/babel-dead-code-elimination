import { traverse, t, type NodePath, type Babel } from "./babel-esm"

/**
 * Rebuilds all scopes of a program from its current AST. Babel's Program crawl
 * keeps nested scopes that were already initialized, so their bindings would
 * still count references from removed code. Forgetting them makes the crawl
 * create fresh nested scopes.
 */
export function crawlProgram(programPath: NodePath<Babel.Program>): void {
  const program = programPath.node
  t.traverseFast(program, (node) => {
    if (node !== program) traverse.cache.scope.delete(node)
  })
  programPath.scope.crawl()
}
