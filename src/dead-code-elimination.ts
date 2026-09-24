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
  isLoopIteratorBinding,
} from "./find-removable-bindings"

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<Babel.File>,
  candidates?: Set<NodePath<Babel.Identifier>>,
) {
  let needsAnotherPass: boolean

  // Bindings that form closed cycles (SCCs) with no external references
  let removableBindings = new Set<Binding>()

  const hasCandidates = candidates !== undefined
  const shouldBeRemoved = (ident: NodePath<Babel.Identifier>): boolean => {
    if (hasCandidates && !candidates.has(ident)) return false

    const binding = ident.scope.getBinding(ident.node.name)

    // If binding is part of a removable cycle, allow removal
    if (binding && removableBindings.has(binding)) return true

    if (binding?.referenced) return false

    // Preserve bindings with constant violations (assignments like x = 2)
    if (binding && binding.constantViolations.length > 0) return false

    // Preserve loop iterator bindings (for...of, for...in)
    if (binding && isLoopIteratorBinding(binding)) return false

    // Preserve unused variables in object patterns when rest element is used
    // For example, in `let { a, ...rest } = ...` even if `a` is unused
    // it needs to remain in the object pattern so that `a` is filtered out of `rest`
    const grandParent = ident.parentPath.parentPath
    if (grandParent?.isObjectPattern()) {
      if (ident.parentPath.isRestElement()) return true
      return !t.isRestElement(grandParent.node.properties.at(-1))
    }

    if (hasCandidates) return candidates.has(ident)
    return true
  }

  do {
    needsAnotherPass = false

    traverse(ast, {
      Program(path) {
        path.scope.crawl()
        removableBindings = findRemovableBindings(path)
      },
      ImportDeclaration(path) {
        // Imports cannot keep another local declaration alive.
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
      },
      VariableDeclarator(path) {
        let id = path.get("id")
        if (id.isIdentifier()) {
          if (shouldBeRemoved(id)) {
            path.remove()
            needsAnotherPass = true
          }
        } else if (id.isObjectPattern() || id.isArrayPattern()) {
          for (let variable of Pattern.findVariables(id)) {
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
      },
      ObjectPattern(path) {
        if (path.node.properties.length !== 0) {
          return
        }
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isFunctionParam =
          path.parentPath.isFunction() &&
          path.parentPath.node.params.includes(path.node)
        if (isWithinDeclarator && !isFunctionParam) {
          Pattern.remove(path)
          needsAnotherPass = true
        }
      },
      ArrayPattern(path) {
        if (!path.node.elements.every((e) => e === null)) {
          return
        }
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isFunctionParam =
          path.parentPath.isFunction() &&
          path.parentPath.node.params.includes(path.node)
        if (isWithinDeclarator && !isFunctionParam) {
          Pattern.remove(path)
          needsAnotherPass = true
        }
      },
      FunctionDeclaration(path) {
        let id = path.get("id")
        if (id.isIdentifier() && shouldBeRemoved(id)) {
          needsAnotherPass = true
          if (
            t.isAssignmentExpression(path.parentPath.node) ||
            t.isVariableDeclarator(path.parentPath.node)
          ) {
            path.parentPath.remove()
          } else {
            path.remove()
          }
        }
      },
    })
  } while (needsAnotherPass)
}
