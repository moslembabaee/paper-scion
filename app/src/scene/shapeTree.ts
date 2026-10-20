import type { BooleanCompound, BooleanOperation, PathElement, VectorElement } from './types.ts'
import { computeBoolean, transformedSource } from './booleanGeometry.ts'
import { createElement } from './elements.ts'

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

function isPolygonPath(d: string): boolean {
  if (!d || !d.trim()) return false
  return !/[CcSsQqTtAa]/.test(d)
}

/**
 * Builds a hierarchical ShapeTreeNode representation from a VectorElement.
 */
export function buildShapeTree(node: VectorElement, depth = 0): ShapeTreeNode {
  if (node.type === 'path' && node.boolean) {
    const compound = node.boolean
    const mutedSet = new Set(compound.mutedOperandIds ?? [])
    const operands = compound.operands.map(op => {
      const childTree = buildShapeTree(op, depth + 1)
      return mutedSet.has(op.id) ? { ...childTree, muted: true } : childTree
    })
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

  const detectedType: ShapeTreeNodeType =
    node.type === 'path' && isPolygonPath(node.d) ? 'polygon' : node.type

  return {
    id: node.id,
    name: node.name,
    type: detectedType,
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
 * Moves a node earlier (-1) or later (+1) among its siblings in its parent compound.
 */
export function moveTreeNode(
  root: ShapeTreeNode,
  targetId: string,
  direction: -1 | 1
): ShapeTreeNode {
  function visit(node: ShapeTreeNode): ShapeTreeNode {
    if (node.type !== 'compound' || !node.operands) return node
    const idx = node.operands.findIndex(c => c.id === targetId)
    if (idx !== -1) {
      const targetIdx = idx + direction
      if (targetIdx < 0 || targetIdx >= node.operands.length) return node
      const nextOperands = [...node.operands]
      const temp = nextOperands[idx]
      nextOperands[idx] = nextOperands[targetIdx]
      nextOperands[targetIdx] = temp
      return { ...node, operands: nextOperands }
    }
    const updatedOperands = node.operands.map(visit)
    return { ...node, operands: updatedOperands }
  }
  return visit(root)
}

/**
 * Updates the boolean operation for a specific compound node in the tree.
 */
export function setTreeNodeOperation(
  root: ShapeTreeNode,
  targetCompoundId: string,
  operation: BooleanOperation
): ShapeTreeNode {
  return updateTreeNode(root, targetCompoundId, node => {
    if (node.type !== 'compound') return node
    return { ...node, operation }
  })
}

/**
 * Updates properties (parameters) of a node within the shape tree.
 */
export function updateTreeNodeParameters(
  root: ShapeTreeNode,
  targetId: string,
  patch: Record<string, unknown>
): ShapeTreeNode {
  return updateTreeNode(root, targetId, node => {
    if (!node.element) return node
    const updatedElement = {
      ...node.element,
      ...patch,
      ...(patch.style ? { style: { ...node.element.style, ...(patch.style as Record<string, unknown>) } } : {}),
    } as VectorElement
    return {
      ...node,
      name: typeof patch.name === 'string' ? patch.name : node.name,
      element: updatedElement,
    }
  })
}

export interface CompoundHierarchyInspection {
  readonly id: string
  readonly name: string
  readonly isCompound: boolean
  readonly operation?: BooleanOperation
  readonly totalLeafCount: number
  readonly maxDepth: number
  readonly directOperandCount: number
  readonly activeOperandCount: number
  readonly mutedOperandCount: number
  readonly operationsUsed: readonly BooleanOperation[]
  readonly tree: ShapeTreeNode
}

/**
 * Computes deep diagnostic metrics for a compound shape hierarchy.
 */
export function inspectCompoundHierarchy(element: VectorElement): CompoundHierarchyInspection {
  const tree = buildShapeTree(element)
  const isCompound = element.type === 'path' && !!element.boolean
  const operations = new Set<BooleanOperation>()
  let maxDepth = 0

  function scan(node: ShapeTreeNode) {
    maxDepth = Math.max(maxDepth, node.depth)
    if (node.operation) operations.add(node.operation)
    if (node.operands) {
      for (const child of node.operands) scan(child)
    }
  }
  scan(tree)

  const directOperands = tree.operands ?? []
  const mutedCount = directOperands.filter(o => o.muted).length

  return {
    id: element.id,
    name: element.name,
    isCompound,
    operation: isCompound ? element.boolean!.operation : undefined,
    totalLeafCount: countTreeLeaves(tree),
    maxDepth,
    directOperandCount: directOperands.length,
    activeOperandCount: directOperands.length - mutedCount,
    mutedOperandCount: mutedCount,
    operationsUsed: Array.from(operations),
    tree,
  }
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

/**
 * Converts a compound ShapeTreeNode into a serializable BooleanCompound representation.
 */
export function shapeTreeToCompound(tree: ShapeTreeNode): BooleanCompound {
  if (tree.type !== 'compound' || !tree.operands) {
    throw new Error('Node is not a compound shape')
  }

  const operands: VectorElement[] = []
  const mutedOperandIds: string[] = []

  for (const child of tree.operands) {
    if (child.muted) {
      mutedOperandIds.push(child.id)
    }
    operands.push(shapeTreeToVectorElement(child))
  }

  return {
    operation: tree.operation ?? 'union',
    operands,
    ...(mutedOperandIds.length > 0 ? { mutedOperandIds } : {}),
  }
}

/**
 * Converts any ShapeTreeNode back into an evaluated VectorElement.
 */
export function shapeTreeToVectorElement(tree: ShapeTreeNode): VectorElement {
  if (tree.type !== 'compound' || !tree.operands || tree.operands.length === 0) {
    return tree.element!
  }

  const compound = shapeTreeToCompound(tree)
  const base = tree.element as PathElement

  const muted = new Set(compound.mutedOperandIds ?? [])
  const activeOperands = compound.operands.filter(op => !muted.has(op.id))
  const operandsToEvaluate = activeOperands.length >= 1 ? activeOperands : compound.operands

  const result = operandsToEvaluate.length === 1
    ? {
        d: (operandsToEvaluate[0] as PathElement).d,
        viewBox: (operandsToEvaluate[0] as PathElement).viewBox,
        bounds: { x: operandsToEvaluate[0].x, y: operandsToEvaluate[0].y, width: operandsToEvaluate[0].width, height: operandsToEvaluate[0].height },
        fillRule: (operandsToEvaluate[0] as PathElement).fillRule ?? 'nonzero',
      }
    : computeBoolean(operandsToEvaluate, compound.operation)

  return {
    ...base,
    ...result.bounds,
    d: result.d,
    viewBox: result.viewBox,
    fillRule: result.fillRule,
    boolean: compound,
  }
}

/**
 * Reverts a shape tree hierarchy completely into a flat list of independent leaf vector elements.
 * If compoundElement is supplied, sources are transformed through the compound's viewBox mapping.
 */
export function revertShapeTreeToElements(
  tree: ShapeTreeNode,
  compoundElement?: PathElement
): VectorElement[] {
  const leaves: VectorElement[] = []

  function collect(node: ShapeTreeNode) {
    if (node.type === 'compound' && node.operands && node.operands.length > 0) {
      for (const child of node.operands) {
        collect(child)
      }
    } else if (node.element) {
      if (compoundElement) {
        const transformed = transformedSource(node.element, compoundElement)
        const restored = createElement('path', {
          id: node.element.id,
          name: node.element.name,
          parentId: compoundElement.parentId,
          ...transformed.bounds,
          d: transformed.d,
          viewBox: transformed.viewBox,
          fillRule: node.element.type === 'path' ? node.element.fillRule : 'nonzero',
          style: node.element.style,
        })
        leaves.push(restored)
      } else {
        leaves.push(node.element)
      }
    }
  }

  collect(tree)
  return leaves
}

/**
 * Flattens a shape tree into a linear depth-first array for rendering hierarchy lists and rows.
 */
export function flattenShapeTree(root: ShapeTreeNode): readonly ShapeTreeNode[] {
  const list: ShapeTreeNode[] = []
  function traverse(node: ShapeTreeNode) {
    list.push(node)
    if (node.operands) {
      for (const child of node.operands) {
        traverse(child)
      }
    }
  }
  traverse(root)
  return list
}

/**
 * Groups specified sibling nodes inside a parent compound into a new nested compound node.
 */
export function nestShapeTreeNodes(
  root: ShapeTreeNode,
  parentCompoundId: string,
  nodeIds: readonly string[],
  operation: BooleanOperation = 'union'
): ShapeTreeNode {
  return updateTreeNode(root, parentCompoundId, node => {
    if (node.type !== 'compound' || !node.operands) return node
    const targetSet = new Set(nodeIds)
    const selectedChildren = node.operands.filter(c => targetSet.has(c.id))
    if (selectedChildren.length < 2) return node

    const firstIndex = node.operands.findIndex(c => targetSet.has(c.id))
    const groupElement = createElement('path', {
      name: `${operation[0].toUpperCase() + operation.slice(1)} Group`,
      d: '',
      viewBox: [0, 0, 100, 100],
      fillRule: 'nonzero',
    })

    const nestedNode: ShapeTreeNode = {
      id: crypto.randomUUID(),
      name: `${operation[0].toUpperCase() + operation.slice(1)} Compound`,
      type: 'compound',
      operation,
      operands: selectedChildren.map(c => ({ ...c, depth: node.depth + 2 })),
      element: groupElement,
      muted: false,
      depth: node.depth + 1,
    }

    const nextOperands: ShapeTreeNode[] = []
    for (let i = 0; i < node.operands.length; i++) {
      if (i === firstIndex) {
        nextOperands.push(nestedNode)
      }
      if (!targetSet.has(node.operands[i].id)) {
        nextOperands.push(node.operands[i])
      }
    }

    return {
      ...node,
      operands: nextOperands,
    }
  })
}

/**
 * Deep clones a ShapeTreeNode with fresh generated IDs.
 */
export function cloneShapeTreeNode(
  node: ShapeTreeNode,
  idGenerator: () => string = () => crypto.randomUUID()
): ShapeTreeNode {
  const newId = idGenerator()
  const newElement = node.element ? { ...node.element, id: newId } : undefined
  const operands = node.operands?.map(child => cloneShapeTreeNode(child, idGenerator))
  return {
    ...node,
    id: newId,
    name: `${node.name} Copy`,
    element: newElement,
    operands,
  }
}
