// Adapted from https://github.com/egoist/babel-plugin-eliminator/blob/d29859396b7708b7f7abbacdd951cbbc80902f00/src/index.ts

import {
  traverse,
  t,
  type NodePath,
  type Babel,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"
import * as Pattern from "./pattern"
import { unexpected } from "./errors"

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<Babel.File>,
  candidates?: Set<NodePath<Babel.Identifier>>,
) {
  let removals: number

  let shouldBeRemoved = (ident: NodePath<Babel.Identifier>) => {
    if (Identifier.isReferenced(ident)) return false
    if (!candidates) return true
    return candidates.has(ident)
  }

  let sweepFunction = (
    path: NodePath<
      | Babel.FunctionDeclaration
      | Babel.FunctionExpression
      | Babel.ArrowFunctionExpression
    >,
  ) => {
    let identifier = Identifier.fromFunction(path)
    if (identifier?.node && shouldBeRemoved(identifier)) {
      removals++

      if (
        t.isAssignmentExpression(path.parentPath.node) ||
        t.isVariableDeclarator(path.parentPath.node)
      ) {
        path.parentPath.remove()
      } else {
        path.remove()
      }
    }
  }

  let sweepImport = (
    path: NodePath<
      | Babel.ImportSpecifier
      | Babel.ImportDefaultSpecifier
      | Babel.ImportNamespaceSpecifier
    >,
  ) => {
    let local = path.get("local")
    if (shouldBeRemoved(local)) {
      path.remove()
      removals++
      if ((path.parent as Babel.ImportDeclaration).specifiers.length === 0) {
        path.parentPath.remove()
      }
    }
  }

  do {
    removals = 0

    traverse(ast, {
      Program(path) {
        path.scope.crawl()
      },
      VariableDeclarator(path) {
        let id = path.get("id")
        if (id.isIdentifier()) {
          if (shouldBeRemoved(id)) {
            path.remove()
            removals++
          }
        } else if (id.isObjectPattern() || id.isArrayPattern()) {
          for (let variable of Pattern.findVariables(id)) {
            if (Identifier.isReferenced(variable)) continue

            let parent = variable.parentPath

            if (parent.isObjectProperty()) {
              parent.remove()
              removals++
              continue
            }

            if (parent.isArrayPattern()) {
              parent.node.elements[variable.key as number] = null
              removals++
              continue
            }

            if (parent.isAssignmentPattern()) {
              if (t.isObjectProperty(parent.parent)) {
                parent.parentPath?.remove()
                removals++
                continue
              }
              if (t.isArrayPattern(parent.parent)) {
                parent.parent.elements[parent.key as number] = null
                removals++
                continue
              }
              throw unexpected(parent)
            }

            if (parent.isRestElement()) {
              parent.remove()
              removals++
              continue
            }

            throw unexpected(parent)
          }
        }
      },
      ObjectPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isEmpty = path.node.properties.length === 0
        if (isWithinDeclarator && isEmpty) {
          Pattern.remove(path)
          removals++
        }
      },
      ArrayPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isEmpty = path.node.elements.every((e) => e === null)
        if (isWithinDeclarator && isEmpty) {
          Pattern.remove(path)
          removals++
        }
      },
      FunctionDeclaration: sweepFunction,
      FunctionExpression: sweepFunction,
      ArrowFunctionExpression: sweepFunction,
      ImportSpecifier: sweepImport,
      ImportDefaultSpecifier: sweepImport,
      ImportNamespaceSpecifier: sweepImport,
    })
  } while (removals > 0)
}
