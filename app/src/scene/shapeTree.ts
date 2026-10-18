import type { BooleanOperation, PathElement, VectorElement } from './types.ts'
import { computeBoolean } from './booleanGeometry.ts'

export type ShapeTreeNodeType = 'rectangle' | 'ellipse' | 'path' | 'polygon' | 'compound'

export interface ShapeTreeNode {
  readonly id: string
  readonly name: string
  readonly type: ShapeTreeNodeType
  readonly operation?: BooleanOperation
  readonly operands?: readonly ShapeTreeNode[]
  readonly element?: VectorElement
  readonly muted?: boolean
  readonly inverted?: boolean
  readonly depth: number
}

/**
 * Builds a hierarchical ShapeTreeNode representation from a VectorElement.
 */
export function buildShapeTree(node: VectorElement, depth = 0): ShapeTreeNode {
  if (node.type === 'path' && node.boolean) {
    const compound = node.boolean
    const operands = compound.operands.map(op => buildShapeTree(op, depth + 1))
    return {
      id: node.id,
      name: node.name,
      type: 'compound',
      operation: compound.operation,
      operands,
      element: node,
      muted: false,
      depth,
    }
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    element: node,
    muted: false,
    depth,
  }
}

/**
 * Counts all underlying leaf vector shapes in a shape tree.
 */
export function countTreeLeaves(tree: ShapeTreeNode): number {
  if (tree.type !== 'compound' || !tree.operands || tree.operands.length === 0) {
    return 1
  }
  return tree.operands.reduce((sum, child) => sum + countTreeLeaves(child), 0)
}

/**
 * Recursively searches for a node in a shape tree by ID.
 */
export function findTreeNode(tree: ShapeTreeNode, id: string): ShapeTreeNode | null {
  if (tree.id === id) return tree
  if (tree.operands) {
    for (const child of tree.operands) {
      const found = findTreeNode(child, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Recursively updates a node in the shape tree matching targetId using a transform function.
 */
export function updateTreeNode(
  root: ShapeTreeNode,
  targetId: string,
  transform: (node: ShapeTreeNode) => ShapeTreeNode
): ShapeTreeNode {
  if (root.id === targetId) {
    return transform(root)
  }
  if (!root.operands) return root

  const nextOperands = root.operands.map(child => updateTreeNode(child, targetId, transform))
  return {
    ...root,
    operands: nextOperands,
  }
}

/**
 * Toggles the muted status of a node in the shape tree.
 * When muted, the node is bypassed during non-destructive evaluation.
 */
export function toggleNodeMute(root: ShapeTreeNode, targetId: string): ShapeTreeNode {
  return updateTreeNode(root, targetId, node => ({
    ...node,
    muted: !node.muted,
  }))
}

/**
 * Inverts an operation or reorders a subtraction base/cutter in the shape tree.
 */
export function invertNodeOperation(root: ShapeTreeNode, targetId: string): ShapeTreeNode {
  return updateTreeNode(root, targetId, node => {
    if (node.type !== 'compound' || !node.operands || node.operands.length < 2) {
      return { ...node, inverted: !node.inverted }
    }
    // For subtract: swap base and cutter
    if (node.operation === 'subtract') {
      const reordered = [node.operands[1], node.operands[0], ...node.operands.slice(2)]
      return { ...node, operands: reordered, inverted: !node.inverted }
    }
    // For other operations, invert operation (union <-> exclude, intersect <-> union)
    const opMap: Record<BooleanOperation, BooleanOperation> = {
      union: 'exclude',
      exclude: 'union',
      subtract: 'intersect',
      intersect: 'subtract',
    }
    return {
      ...node,
      operation: node.operation ? opMap[node.operation] : 'union',
      inverted: !node.inverted,
    }
  })
}

/**
 * Dissolves / unwraps a compound node within a tree so its children are promoted to the parent.
 */
export function dissolveTreeNode(root: ShapeTreeNode, targetId: string): ShapeTreeNode {
  if (root.id === targetId) {
    // Cannot dissolve root directly without a parent; return root as is
    return root
  }
  if (!root.operands) return root

  const newOperands: ShapeTreeNode[] = []
  for (const child of root.operands) {
    if (child.id === targetId && child.type === 'compound' && child.operands) {
      // Promote all grandchildren to this level
      for (const grandChild of child.operands) {
        newOperands.push({ ...grandChild, depth: root.depth + 1 })
      }
    } else {
      newOperands.push(dissolveTreeNode(child, targetId))
    }
  }

  return {
    ...root,
    operands: newOperands,
  }
}

/**
 * Extracts a specific operand out of the tree.
 * Returns the updated tree and the extracted VectorElement.
 */
export function extractTreeNode(
  root: ShapeTreeNode,
  targetId: string
): { updatedRoot: ShapeTreeNode | null; extracted: VectorElement | null } {
  let extracted: VectorElement | null = null

  function remove(node: ShapeTreeNode): ShapeTreeNode | null {
    if (node.id === targetId) {
      extracted = node.element ?? null
      return null
    }
    if (!node.operands) return node

    const filtered: ShapeTreeNode[] = []
    for (const child of node.operands) {
      const nextChild = remove(child)
      if (nextChild) filtered.push(nextChild)
    }

    if (node.type === 'compound' && filtered.length === 0) {
      return null
    }

    return {
      ...node,
      operands: filtered,
    }
  }

  const updatedRoot = remove(root)
  return { updatedRoot, extracted }
}

/**
 * Reorders the direct children of a compound node in the tree.
 */
export function reorderTreeChildren(
  root: ShapeTreeNode,
  compoundId: string,
  newOrderIds: readonly string[]
): ShapeTreeNode {
  return updateTreeNode(root, compoundId, node => {
    if (node.type !== 'compound' || !node.operands) return node
    const childMap = new Map(node.operands.map(child => [child.id, child]))
    const reordered: ShapeTreeNode[] = []
    for (const id of newOrderIds) {
      const child = childMap.get(id)
      if (child) reordered.push(child)
    }
    // Include any children not mentioned in newOrderIds
    for (const child of node.operands) {
      if (!newOrderIds.includes(child.id)) {
        reordered.push(child)
      }
    }
    return { ...node, operands: reordered }
  })
}

/**
 * Evaluates a ShapeTreeNode hierarchy non-destructively.
 * Skips muted nodes and recursively evaluates child compounds.
 */
export function evaluateShapeTree(tree: ShapeTreeNode): VectorElement {
  if (tree.type !== 'compound' || !tree.operands || tree.operands.length === 0) {
    return tree.element!
  }

  // Filter out muted operands
  const activeOperands = tree.operands.filter(child => !child.muted)
  if (activeOperands.length === 0) {
    return tree.element!
  }
  if (activeOperands.length === 1) {
    return evaluateShapeTree(activeOperands[0])
  }

  // Recursively evaluate children
  const evaluatedChildren: VectorElement[] = activeOperands.map(child => evaluateShapeTree(child))
  const operation = tree.operation ?? 'union'
  const result = computeBoolean(evaluatedChildren, operation)

  const baseElement = tree.element as PathElement
  return {
    ...baseElement,
    d: result.d,
    viewBox: result.viewBox,
    fillRule: result.fillRule,
    boolean: {
      operation,
      operands: evaluatedChildren,
    },
  }
}
