import {
  traverse,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import type { Visitor } from "@babel/traverse"
import { crawlProgram, mustCrawlProgram } from "./scope"
import { forEachMatchingPath, getProgramPath } from "./walk"
import { DECLARATION_TYPES, forEachDeclaredIdentifier } from "./declarations"
import {
  findDeadCycleBindings,
  getDeclaredBinding,
  isReferenced,
  type KeepLocalCall,
} from "./find-removable-bindings"

type IdentifierPath = NodePath<Babel.Identifier>
type ScopeOptions = {
  /** The AST has not changed since Babel last built its scopes. */
  scopeIsFresh?: boolean
  /**
   * The same predicate given to `deadCodeElimination`: a local inside a
   * function whose only use is a call the predicate rejects is as unused as
   * elimination finds it, so the set holds no cycle that such a call alone
   * keeps alive. See DeadCodeEliminationOptions.
   */
  keepLocalCall?: KeepLocalCall
}

// A name is referenced when something reads it, unless only its own closed
// dead cycle does: nothing a transform removes can make such a cycle unused.
// Cycles are found within each scope, so locals that only read each other
// count as unused like such module declarations (decision R2-D5).
function addIfReferenced(
  ident: IdentifierPath,
  deadCycles: DeadCycles,
  referenced: Set<IdentifierPath>,
): void {
  const binding = getDeclaredBinding(ident)
  if (binding && isReferenced(binding) && !deadCycles(binding)) {
    referenced.add(ident)
  }
}

type DeadCycles = (binding: Binding) => boolean

/** Whether a binding is in a closed dead cycle of its scope, scope by scope. */
function deadCyclesByScope(keep: KeepLocalCall | undefined): DeadCycles {
  const byScope = new Map<Binding["scope"], Set<Binding>>()
  return (binding) => {
    let cycles = byScope.get(binding.scope)
    if (!cycles) {
      cycles = findDeadCycleBindings(binding.scope.path, keep)
      byScope.set(binding.scope, cycles)
    }
    return cycles.has(binding)
  }
}

function declarationVisitor(
  identifier: (path: IdentifierPath) => void,
): Visitor {
  const declaration = (path: NodePath) =>
    forEachDeclaredIdentifier(path, identifier)
  return {
    ImportDeclaration: declaration,
    VariableDeclarator: declaration,
    FunctionDeclaration: declaration,
    ClassDeclaration: declaration,
  }
}

export default function (
  ast: ParseResult<Babel.File>,
  options?: ScopeOptions,
): Set<IdentifierPath> {
  const referenced = new Set<IdentifierPath>()
  const crawl = !options?.scopeIsFresh && mustCrawlProgram(ast)
  const programPath = getProgramPath(ast)
  if (crawl) {
    crawlProgram(programPath)
  }
  const deadCycles = deadCyclesByScope(options?.keepLocalCall)
  // Declarations are found without a second Babel traversal (see walk.ts).
  forEachMatchingPath(
    programPath,
    (node) => DECLARATION_TYPES.has(node.type),
    (path) =>
      forEachDeclaredIdentifier(path, (ident) =>
        addIfReferenced(ident, deadCycles, referenced),
      ),
  )
  return referenced
}

/**
 * Share an analysis traversal with declaration collection. The visitor must
 * preserve the AST and bindings and visit every node (no skip, stop, denylist,
 * shouldSkip, or other traversal pruning). Invoke the returned function before
 * mutating the AST to resolve reference membership.
 * Callers that do not need references can discard it without graph analysis.
 */
export function collectReferencedIdentifiers(
  ast: ParseResult<Babel.File>,
  options: ScopeOptions & { visitor: Visitor },
): () => Set<IdentifierPath> {
  const identifiers: Array<IdentifierPath> = []
  const visitor = declarationVisitor((ident) => identifiers.push(ident))
  if (!options.scopeIsFresh && mustCrawlProgram(ast)) {
    visitor.enter = (path) => {
      // File traversal starts at Program. Restore the supplied generic callbacks
      // for subsequent nodes without changing the currently iterated callback list.
      mergedVisitor.enter = options.visitor.enter
      crawlProgram(path as NodePath<Babel.Program>)
    }
  }
  const mergedVisitor = traverse.visitors.merge([visitor, options.visitor])
  traverse(ast, mergedVisitor)
  return () => {
    const referenced = new Set<IdentifierPath>()
    const deadCycles = deadCyclesByScope(options.keepLocalCall)
    for (const ident of identifiers) {
      addIfReferenced(ident, deadCycles, referenced)
    }
    return referenced
  }
}
