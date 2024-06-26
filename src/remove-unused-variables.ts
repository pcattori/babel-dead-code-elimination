import {
  t,
  traverse,
  type NodePath,
  type BabelTypes,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"

export default function (ast: ParseResult<BabelTypes.File>) {
  let changed: boolean
  do {
    changed = false
    traverse(ast, {
      Program(path) {
        path.scope.crawl()
      },
      // function: decl, expr, arrow
      // catch
      // import
      // class: decl, prop, method
      // ts: enum decl, interface decl, type alias decl
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id)) {
          let local = path.get("id") as NodePath<BabelTypes.Identifier>
          if (!Identifier.isReferenced(local)) {
            path.remove()
            changed = true
          }
          return
        }

        if (t.isObjectPattern(path.node.id)) {
          // rest: ...x
          // assignment: {x=1}
          let local = path.get("id") as NodePath<BabelTypes.ObjectPattern>

          let identifiers = findVariablesInObjectPattern(local)
          for (let identifier of identifiers) {
            if (!Identifier.isReferenced(identifier)) {
              identifier.parentPath.remove()
              changed = true

              let objectPattern = identifier.find((p) =>
                p.isObjectPattern(),
              ) as NodePath<t.ObjectPattern> | null
              if (objectPattern && objectPattern.node.properties.length === 0) {
                objectPattern.parentPath.remove()
                // TODO: what about array pattern parent? and what if that parent has an obj pattern or array pattern parent, etc.?
              }
            }
          }
          return
        }

        if (t.isArrayPattern(path.node.id)) {
          // rest: ...x
          // assignment: [x=1]
        }
      },
    })
  } while (changed)
}

function findVariablesInObjectPattern(
  path: NodePath<t.ObjectPattern>,
): NodePath<t.Identifier>[] {
  let variables: NodePath<t.Identifier>[] = []
  function recurse(path: NodePath) {
    if (path.isIdentifier()) {
      return variables.push(path)
    }
    if (path.isObjectProperty()) {
      return recurse(path.get("value"))
    }
    if (path.isObjectPattern()) {
      return path.get("properties").forEach(recurse)
    }
    if (path.isRestElement()) {
      return recurse(path.get("argument"))
    }
    // TODO: assignment pattern!
    path.buildCodeFrameError(
      `Failed to find variables within object pattern due to unrecognized node type: ${path.node.type}`,
    )
  }
  recurse(path)
  return variables
}
