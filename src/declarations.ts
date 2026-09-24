import { type NodePath, type Babel } from "./babel-esm"
import * as Pattern from "./pattern"

type IdentifierPath = NodePath<Babel.Identifier>

/** Node types whose identifiers elimination and reference analysis consider. */
export const DECLARATION_TYPES = new Set([
  "ImportDeclaration",
  "VariableDeclarator",
  "FunctionDeclaration",
  "ClassDeclaration",
])

/** Calls `identifier` for each identifier that a declaration path declares. */
export function forEachDeclaredIdentifier(
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
