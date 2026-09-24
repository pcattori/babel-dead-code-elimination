import { type Node, type NodePath } from "./babel-esm"

export function unexpected(path: NodePath<Node | null>) {
  let type = path.node === null ? "null" : path.node.type
  let message = `[babel-dead-code-elimination] unexpected node type: ${type}`
  // Code frames need a File hub, which traversing a bare AST does not create.
  return path.hub ? path.buildCodeFrameError(message) : new Error(message)
}
