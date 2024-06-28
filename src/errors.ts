import { type Node, type NodePath } from "./babel-esm"

export function unexpected(path: NodePath<Node | null>) {
  let type = path.node === null ? "null" : path.node.type
  return path.buildCodeFrameError(
    `[babel-dead-code-elimination] unexpected node type: ${type}`,
  )
}
