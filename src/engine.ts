import paper from 'paper'
import type { ShapeStyle, BooleanOp } from './types'

let _scope: paper.PaperScope | null = null

export function initEngine(canvas: HTMLCanvasElement): paper.PaperScope {
  _scope = new paper.PaperScope()
  _scope.setup(canvas)
  _scope.view.zoom = 1
  _scope.settings.insertItems = true
  return _scope
}

export function getScope(): paper.PaperScope {
  if (!_scope) throw new Error('Engine not initialized')
  return _scope
}

export function getProject(): paper.Project {
  return getScope().project
}

let _idCounter = 0
export function nextId(): string {
  return `shape_${++_idCounter}_${Date.now()}`
}

export function applyStyle(item: paper.Item, style: ShapeStyle) {
  if (style.fillColor) {
    item.fillColor = new paper.Color(style.fillColor)
  } else {
    item.fillColor = null as any
  }
  if (style.strokeWidth > 0) {
    item.strokeColor = new paper.Color(style.strokeColor)
    item.strokeWidth = style.strokeWidth
  } else {
    item.strokeColor = null
    item.strokeWidth = 0
  }
  item.opacity = style.opacity
}

// --- Shape creation ---

export function createRectangle(from: paper.Point, to: paper.Point, style: ShapeStyle): paper.Path.Rectangle {
  const rect = new paper.Path.Rectangle({
    from, to,
    insert: true,
  })
  applyStyle(rect, style)
  return rect
}

export function createCircle(center: paper.Point, radius: number, style: ShapeStyle): paper.Path.Circle {
  const circle = new paper.Path.Circle({
    center, radius,
    insert: true,
  })
  applyStyle(circle, style)
  return circle
}

export function createRoundedRect(from: paper.Point, to: paper.Point, radius: number, style: ShapeStyle): paper.Path {
  const rect = new paper.Path.Rectangle({
    from, to,
    radius,
    insert: true,
  })
  applyStyle(rect, style)
  return rect
}

export function createPolygon(center: paper.Point, sides: number, radius: number, style: ShapeStyle): paper.Path.RegularPolygon {
  const poly = new paper.Path.RegularPolygon({
    center, sides, radius,
    insert: true,
  })
  applyStyle(poly, style)
  return poly
}

export function createStar(center: paper.Point, points: number, innerRadius: number, outerRadius: number, style: ShapeStyle): paper.Path.Star {
  const star = new paper.Path.Star({
    center, points,
    radius1: innerRadius,
    radius2: outerRadius,
    insert: true,
  })
  applyStyle(star, style)
  return star
}

// --- Boolean operations ---

function applyBoolOp(op: BooleanOp, a: paper.PathItem, b: paper.PathItem): paper.PathItem {
  switch (op) {
    case 'unite': return a.unite(b)
    case 'subtract': return a.subtract(b)
    case 'intersect': return a.intersect(b)
    case 'exclude': return a.exclude(b)
  }
}

/** Batch boolean: reduce N paths with an operation. Returns the single combined result. Removes all source paths. */
export function batchBooleanOp(op: BooleanOp, paths: paper.PathItem[], style: ShapeStyle): paper.PathItem | null {
  if (paths.length === 0) return null
  if (paths.length === 1) {
    applyStyle(paths[0], style)
    return paths[0]
  }

  let result = paths[0]
  for (let i = 1; i < paths.length; i++) {
    const next = applyBoolOp(op, result, paths[i])
    // Remove intermediates (but not the original first one yet)
    if (i > 1) result.remove()
    paths[i].remove()
    result = next
  }
  // Remove the original first path
  paths[0].remove()
  applyStyle(result, style)
  return result
}

// --- Proximity clustering ---

/** Compute the minimum gap between two bounding boxes. Returns 0 if they overlap. */
function bboxGap(a: paper.Rectangle, b: paper.Rectangle): number {
  const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right))
  const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom))
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Groups shapes into clusters where each shape's bounding box is within `threshold` px
 * of at least one other shape in the cluster (single-linkage clustering).
 * Returns arrays of shapeIds grouped together.
 */
export function findProximityClusters(shapeIds: string[], threshold: number): string[][] {
  const drawLayer = getDrawLayer()
  const items: { id: string; bounds: paper.Rectangle }[] = []

  for (const sid of shapeIds) {
    const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
    if (item) {
      items.push({ id: sid, bounds: item.bounds })
    }
  }

  if (items.length === 0) return []

  // Union-Find for single-linkage clustering
  const parent = new Map<string, string>()
  for (const it of items) parent.set(it.id, it.id)

  function find(x: string): string {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!)
      x = parent.get(x)!
    }
    return x
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // Compare all pairs
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const gap = bboxGap(items[i].bounds, items[j].bounds)
      if (gap <= threshold) {
        union(items[i].id, items[j].id)
      }
    }
  }

  // Collect clusters
  const clusters = new Map<string, string[]>()
  for (const it of items) {
    const root = find(it.id)
    if (!clusters.has(root)) clusters.set(root, [])
    clusters.get(root)!.push(it.id)
  }

  // Only return clusters with 2+ shapes
  return Array.from(clusters.values()).filter((c) => c.length >= 2)
}

// --- Export ---

/** Get the draw layer (skip grid layer) */
export function getDrawLayer(): paper.Layer {
  const project = getProject()
  return project.layers.find((l) => l.name === 'draw') ?? project.activeLayer
}

/** Returns true if an item is an overlay, guide, or other non-shape helper */
function isExportExcluded(item: paper.Item): boolean {
  return !!(item.data?.isOverlay || item.data?.isGuide || item.data?.isNodeOverlay)
}

/**
 * Temporarily hide all overlay/guide items on the draw layer,
 * run the callback, then restore their visibility.
 */
function withCleanLayer<T>(fn: (drawLayer: paper.Layer) => T): T {
  const drawLayer = getDrawLayer()
  const hidden: paper.Item[] = []
  for (const child of drawLayer.children) {
    if (isExportExcluded(child) && child.visible) {
      child.visible = false
      hidden.push(child)
    }
  }
  try {
    return fn(drawLayer)
  } finally {
    for (const item of hidden) {
      item.visible = true
    }
  }
}

export function exportSVG(): string {
  return withCleanLayer((drawLayer) => {
    return drawLayer.exportSVG({ asString: true }) as string
  })
}

export function exportSVGPath(): string {
  return withCleanLayer((drawLayer) => {
    const items = drawLayer.children.filter((c) => c.visible && !isExportExcluded(c))
    if (items.length === 0) return ''
    // Unite all visible paths into one for export
    let combined: paper.PathItem | null = null
    for (const item of items) {
      if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
        if (!combined) {
          combined = item.clone() as paper.PathItem
        } else {
          const next: paper.PathItem = combined.unite(item as paper.PathItem)
          combined.remove()
          combined = next
        }
      }
    }
    if (!combined) return ''
    const pathData = combined.pathData
    combined.remove()
    return pathData
  })
}

export function exportCSSClipPath(): string {
  const pathData = exportSVGPath()
  if (!pathData) return ''
  return `clip-path: path('${pathData}');`
}

export function exportPNG(scale = 2): Promise<Blob> {
  return new Promise((resolve) => {
    withCleanLayer((drawLayer) => {
      const raster = drawLayer.rasterize({ resolution: 72 * scale, insert: false })
      const canvas = raster.canvas as HTMLCanvasElement
      canvas.toBlob((blob) => {
        resolve(blob!)
      }, 'image/png')
    })
  })
}

