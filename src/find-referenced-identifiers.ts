import {
  traverse,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import type { Visitor } from "@babel/traverse"
import * as Pattern from "./pattern"
import { crawlProgram, mustCrawlProgram } from "./scope"
import { forEachMatchingPath, getProgramPath } from "./walk"
import findRemovableBindings, {
  getDeclaredBinding,
  isReferenced,
} from "./find-removable-bindings"

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
  const binding = getDeclaredBinding(ident)
  if (binding && !removable.has(binding) && isReferenced(binding)) {
    referenced.add(ident)
  }
}

const DECLARATION_TYPES = new Set([
  "ImportDeclaration",
  "VariableDeclarator",
  "FunctionDeclaration",
  "ClassDeclaration",
])

/** Calls `identifier` for each identifier that a declaration path declares. */
function forEachDeclaredIdentifier(
  path: NodePath,
  identifier: (path: IdentifierPath) => void,
): void {
  if (path.isImportDeclaration()) {
    for (const specifier of path.get("specifiers")) {
      identifier(specifier.get("local"))
    }
  } else if (path.isVariableDeclarator()) {
    const id = path.get("id")
    if (id.isIdentifier()) {
      identifier(id)
    } else if (id.isObjectPattern() || id.isArrayPattern()) {
      for (const variable of Pattern.findVariables(id)) {
        identifier(variable)
      }
    }
  } else if (path.isFunctionDeclaration() || path.isClassDeclaration()) {
    const id = path.get("id") as NodePath
    if (id.isIdentifier()) {
      identifier(id)
    }
  }
}

function declarationVisitor(
  program: (path: NodePath<Babel.Program>) => void,
  identifier: (path: IdentifierPath) => void,
): Visitor {
  const declaration = (path: NodePath) =>
    forEachDeclaredIdentifier(path, identifier)
  return {
    Program: program,
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
  const removable = findRemovableBindings(programPath)
  // Declarations are found without a second Babel traversal (see walk.ts).
  forEachMatchingPath(
    programPath,
    (node) => DECLARATION_TYPES.has(node.type),
    (path) =>
      forEachDeclaredIdentifier(path, (ident) =>
        addIfReferenced(ident, removable, referenced),
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
    const removable = findRemovableBindings(programPath)
    for (const ident of identifiers) {
      addIfReferenced(ident, removable, referenced)
    }
    return referenced
  }
}
