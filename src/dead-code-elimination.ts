import {
  traverse,
  t,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import * as Pattern from "./pattern"
import { unexpected } from "./errors"
import findRemovableBindings, {
  getDeclaredBinding,
  isLoopIteratorBinding,
} from "./find-removable-bindings"

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

  // Bindings that form closed cycles (SCCs) with no external references
  let removableBindings: Set<Binding>

  const hasCandidates = candidates !== undefined
  // Elimination keeps bindings outside the candidate set, so they must keep
  // everything they reference alive, including members of reference cycles.
  let isKept: ((binding: Binding) => boolean) | undefined
  if (hasCandidates) {
    const candidateNodes = new Set<Babel.Node>()
    for (const candidate of candidates) candidateNodes.add(candidate.node)
    isKept = (binding) => !candidateNodes.has(binding.identifier)
  }
  const shouldBeRemoved = (ident: NodePath<Babel.Identifier>): boolean => {
    if (hasCandidates && !candidates.has(ident)) return false

    const binding = getDeclaredBinding(ident)

    // Only remove a declaration whose own binding is known. Removing a sole
    // declarator also removes its declaration, and Babel deletes the name
    // from scope for both, so the second deletion can drop a same-named
    // binding of an enclosing scope until the next crawl.
    if (binding?.identifier !== ident.node) return false

    // If binding is part of a removable cycle, allow removal
    if (removableBindings.has(binding)) return true

    if (binding.referenced) return false

    // Preserve bindings with constant violations (assignments like x = 2)
    if (binding.constantViolations.length > 0) return false

    // Preserve loop iterator bindings (for...of, for...in)
    if (isLoopIteratorBinding(binding)) return false

    return true
  }

  const visit = (path: NodePath): void => {
    if (path.isImportDeclaration()) {
      // Imports contain no references to other local bindings, so removing
      // them cannot make another declaration dead or require another pass.
      if (path.node.specifiers.length === 0) {
        return
      }
      for (let specifier of path.get("specifiers")) {
        let local = specifier.get("local")
        if (shouldBeRemoved(local)) {
          specifier.remove()
        }
      }
      if (path.node.specifiers.length === 0) {
        path.remove()
      }
      return
    }
    if (path.isVariableDeclarator()) {
      let id = path.get("id")
      if (id.isIdentifier()) {
        if (shouldBeRemoved(id)) {
          path.remove()
          needsAnotherPass = true
        }
      } else if (id.isObjectPattern() || id.isArrayPattern()) {
        for (let variable of Pattern.findVariables(id)) {
          // Keep unused variables that are filtered out of an object rest: in
          // `let { a, ...rest } = ...`, removing `a` would add it to `rest`.
          // This includes defaults and nested patterns, and takes precedence
          // over removable cycles.
          if (Pattern.isRestFiltered(id.node, variable.node)) continue
          if (!shouldBeRemoved(variable)) continue

          let parent = variable.parentPath

          if (parent.isObjectProperty()) {
            parent.remove()
            needsAnotherPass = true
            continue
          }

          if (parent.isArrayPattern()) {
            parent.node.elements[variable.key as number] = null
            needsAnotherPass = true
            continue
          }

          if (parent.isAssignmentPattern()) {
            if (t.isObjectProperty(parent.parent)) {
              parent.parentPath?.remove()
              needsAnotherPass = true
              continue
            }
            if (t.isArrayPattern(parent.parent)) {
              parent.parent.elements[parent.key as number] = null
              needsAnotherPass = true
              continue
            }
            throw unexpected(parent)
          }

          if (parent.isRestElement()) {
            parent.remove()
            needsAnotherPass = true
            continue
          }

          throw unexpected(parent)
        }
      }
      return
    }
    if (path.isObjectPattern()) {
      if (path.node.properties.length !== 0) {
        return
      }
      let declarator = Pattern.findDeclarator(path)
      if (
        declarator &&
        !Pattern.isRestFiltered(declarator.node.id, path.node)
      ) {
        Pattern.remove(path)
        needsAnotherPass = true
      }
      return
    }
    if (path.isArrayPattern()) {
      if (!path.node.elements.every((element) => element === null)) {
        return
      }
      let declarator = Pattern.findDeclarator(path)
      if (
        declarator &&
        !Pattern.isRestFiltered(declarator.node.id, path.node)
      ) {
        Pattern.remove(path)
        needsAnotherPass = true
      }
      return
    }
    if (path.isFunctionDeclaration()) {
      let id = path.get("id")
      if (id.isIdentifier() && shouldBeRemoved(id)) {
        needsAnotherPass = true
        path.remove()
      }
      return
    }
  }

  const collect = (path: NodePath): void => {
    paths.push(path)
    visit(path)
  }

  traverse(ast, {
    Program(path) {
      programPath = path
      path.scope.crawl()
      removableBindings = findRemovableBindings(path, isKept)
    },
    ImportDeclaration: collect,
    VariableDeclarator: collect,
    ObjectPattern: collect,
    ArrayPattern: collect,
    FunctionDeclaration: collect,
  })

  // Elimination only removes nodes. Revisit the original declaration paths in
  // source order, without traversing unchanged expressions on every iteration.
  while (needsAnotherPass) {
    needsAnotherPass = false
    programPath.scope.crawl()
    removableBindings = findRemovableBindings(programPath, isKept)
    for (const path of paths) {
      if (isAttached(path)) {
        visit(path)
      }
    }
  }
}

// Babel removal clears the removed path, not its descendants. Pattern cleanup
// also writes array holes directly. These are the only structural edits above.
function isAttached(path: NodePath): boolean {
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
