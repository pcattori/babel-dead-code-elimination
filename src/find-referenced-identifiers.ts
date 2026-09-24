import {
  traverse,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import type { Visitor } from "@babel/traverse"
import * as Pattern from "./pattern"
import findRemovableBindings from "./find-removable-bindings"

type IdentifierPath = NodePath<Babel.Identifier>
type ScopeOptions = {
  /** The AST has not changed since Babel last built its scopes. */
  scopeIsFresh?: boolean
}

function addIfReferenced(
  ident: IdentifierPath,
  removable: Set<Binding>,
  referenced: Set<IdentifierPath>,
): void {
  const binding = ident.scope.getBinding(ident.node.name)
  if (binding && !removable.has(binding) && binding.referenced) {
    referenced.add(ident)
  }
}

function declarationVisitor(
  program: (path: NodePath<Babel.Program>) => void,
  identifier: (path: IdentifierPath) => void,
): Visitor {
  return {
    Program: program,
    ImportDeclaration(path) {
      for (const specifier of path.get("specifiers")) {
        identifier(specifier.get("local"))
      }
    },
    VariableDeclarator(path) {
      const id = path.get("id")
      if (id.isIdentifier()) {
        identifier(id)
      } else if (id.isObjectPattern() || id.isArrayPattern()) {
        for (const variable of Pattern.findVariables(id)) {
          identifier(variable)
        }
      }
    },
    FunctionDeclaration(path) {
      const id = path.get("id")
      if (id.isIdentifier()) {
        identifier(id)
      }
    },
  }
}

export default function (
  ast: ParseResult<Babel.File>,
  options?: ScopeOptions,
): Set<IdentifierPath> {
  const referenced = new Set<IdentifierPath>()
  let removable: Set<Binding>
  traverse(
    ast,
    declarationVisitor(
      (path) => {
        if (!options?.scopeIsFresh) {
          path.scope.crawl()
        }
        removable = findRemovableBindings(path)
      },
      (ident) => addIfReferenced(ident, removable, referenced),
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
  let programPath!: NodePath<Babel.Program>
  const visitor = declarationVisitor(
    (path) => {
      programPath = path
    },
    (ident) => identifiers.push(ident),
  )
  if (!options.scopeIsFresh) {
    visitor.enter = (path) => {
      // File traversal starts at Program. Restore the supplied generic callbacks
      // for subsequent nodes without changing the currently iterated callback list.
      mergedVisitor.enter = options.visitor.enter
      path.scope.crawl()
    }
  }
  const mergedVisitor = traverse.visitors.merge([visitor, options.visitor])
  traverse(ast, mergedVisitor)
  return () => {
    const referenced = new Set<IdentifierPath>()
    const removable = findRemovableBindings(programPath)
    for (const ident of identifiers) {
      addIfReferenced(ident, removable, referenced)
    }
    return referenced
  }
}
