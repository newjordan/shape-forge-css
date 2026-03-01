import paper from 'paper'
import type { ShapeStyle, BooleanOp, TraceChannel, TraceOptions, ContourData, TraceResult } from './types'

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
    const fc = new paper.Color(style.fillColor)
    if (style.fillOpacity !== undefined) fc.alpha = style.fillOpacity
    item.fillColor = fc
  } else {
    item.fillColor = null as any
  }
  if (style.strokeWidth > 0) {
    const sc = new paper.Color(style.strokeColor)
    if (style.strokeOpacity !== undefined) sc.alpha = style.strokeOpacity
    item.strokeColor = sc
    item.strokeWidth = style.strokeWidth
  } else {
    item.strokeColor = null
    item.strokeWidth = 0
  }
  item.opacity = style.opacity
  // Dash array
  if (style.dashArray && style.dashArray.length > 0) {
    item.dashArray = style.dashArray
  } else {
    item.dashArray = []
  }
  // Stroke cap & join
  if (style.strokeCap) {
    item.strokeCap = style.strokeCap
  }
  if (style.strokeJoin) {
    item.strokeJoin = style.strokeJoin
  }
  // Drop shadow
  if (style.shadowColor) {
    item.shadowColor = new paper.Color(style.shadowColor)
    item.shadowBlur = style.shadowBlur ?? 0
    item.shadowOffset = new paper.Point(style.shadowOffsetX ?? 0, style.shadowOffsetY ?? 0)
  } else {
    item.shadowColor = null as any
    item.shadowBlur = 0
    item.shadowOffset = new paper.Point(0, 0)
  }
  // Arrow markers (store in data for overlay drawing)
  if (item.data) {
    item.data.arrowStart = !!style.arrowStart
    item.data.arrowEnd = !!style.arrowEnd
  }
}

/** Draw arrow marker triangles for a line item. Returns a Group with arrow paths, or null. */
export function drawArrowMarkers(item: paper.Item, style: ShapeStyle): paper.Group | null {
  if (!style.arrowStart && !style.arrowEnd) return null
  if (!(item instanceof paper.Path) || item.segments.length < 2) return null
  const strokeColor = style.strokeWidth > 0 ? new paper.Color(style.strokeColor) : new paper.Color('#ffffff')
  const arrowSize = Math.max(8, (style.strokeWidth || 1) * 4)
  const children: paper.Item[] = []

  if (style.arrowEnd) {
    const lastSeg = item.segments[item.segments.length - 1]
    const prevSeg = item.segments[item.segments.length - 2]
    const dir = lastSeg.point.subtract(prevSeg.point).normalize()
    const tip = lastSeg.point
    const perp = dir.rotate(90, new paper.Point(0, 0))
    const base = tip.subtract(dir.multiply(arrowSize))
    const tri = new paper.Path([
      tip,
      base.add(perp.multiply(arrowSize * 0.4)),
      base.subtract(perp.multiply(arrowSize * 0.4)),
    ])
    tri.closed = true
    tri.fillColor = strokeColor
    tri.data = { isArrowMarker: true }
    children.push(tri)
  }

  if (style.arrowStart) {
    const firstSeg = item.segments[0]
    const nextSeg = item.segments[1]
    const dir = firstSeg.point.subtract(nextSeg.point).normalize()
    const tip = firstSeg.point
    const perp = dir.rotate(90, new paper.Point(0, 0))
    const base = tip.subtract(dir.multiply(arrowSize))
    const tri = new paper.Path([
      tip,
      base.add(perp.multiply(arrowSize * 0.4)),
      base.subtract(perp.multiply(arrowSize * 0.4)),
    ])
    tri.closed = true
    tri.fillColor = strokeColor
    tri.data = { isArrowMarker: true }
    children.push(tri)
  }

  if (children.length === 0) return null
  const grp = new paper.Group(children)
  grp.data = { isArrowMarker: true }
  return grp
}

// --- Shape creation ---

export function createLine(from: paper.Point, to: paper.Point, style: ShapeStyle): paper.Path.Line {
  const line = new paper.Path.Line({
    from, to,
    insert: true,
  })
  // Lines use stroke style only; fill is irrelevant
  applyStyle(line, { ...style, fillColor: null })
  return line
}

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

/**
 * Regenerate a primitive shape in-place: replace the existing Paper.js item
 * with a new one using updated params, preserving position, rotation, and scale.
 * Returns the new item (already inserted into the draw layer).
 */
export function regeneratePrimitive(
  oldItem: paper.Item,
  primitiveType: string,
  params: { cornerRadius?: number; sides?: number; points?: number; innerRadius?: number; outerRadius?: number },
  style: import('./types').ShapeStyle,
): paper.Item | null {
  const bounds = oldItem.bounds
  const center = bounds.center
  const from = bounds.topLeft
  const to = bounds.bottomRight
  const radius = Math.max(bounds.width, bounds.height) / 2

  let newItem: paper.Item | null = null
  switch (primitiveType) {
    case 'roundedRect':
      newItem = createRoundedRect(from, to, params.cornerRadius ?? 12, style)
      break
    case 'polygon':
      newItem = createPolygon(center, params.sides ?? 6, radius, style)
      break
    case 'star':
      newItem = createStar(center, params.points ?? 5, params.innerRadius ?? radius * 0.4, params.outerRadius ?? radius, style)
      break
    default:
      return null
  }

  if (newItem) {
    // Copy the shapeId data
    newItem.data = { ...oldItem.data }
    // Insert at the same position in the layer
    oldItem.parent.insertChild(oldItem.index, newItem)
    oldItem.remove()
  }
  return newItem
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

/**
 * Snapshot the draw layer for undo/redo history.
 *
 * We intentionally exclude overlays/guides and only serialize items that represent shapes.
 * The returned JSON is designed to be imported into the draw layer (see replaceDrawLayerFromHistoryJSON).
 */
export function exportHistoryJSON(): string {
  const drawLayer = getDrawLayer()

  // Clone ONLY non-overlay children into a temporary group.
  // (Do not rely on `visible`, since hidden shapes must still be captured.)
  const clones = drawLayer.children
    .filter((c) => !isExportExcluded(c))
    .map((c) => c.clone({ insert: false }))

  // `insert: false` avoids mutating the live project during snapshotting.
  const tempGroup = new paper.Group({ children: clones, insert: false })
  const json = tempGroup.exportJSON()
  tempGroup.remove()
  return json
}

/**
 * Replace the draw layer contents from a history JSON snapshot.
 *
 * This expects JSON produced by exportHistoryJSON(). It imports a temporary wrapper group,
 * then hoists its children so shapes remain direct children of the draw layer.
 */
export function replaceDrawLayerFromHistoryJSON(json: string): void {
  const drawLayer = getDrawLayer()
  drawLayer.removeChildren()
  drawLayer.activate()

  const imported = drawLayer.importJSON(json) as paper.Item
  if (!imported) return

  // Keep shape items as direct children of the draw layer.
  if (imported instanceof paper.Group) {
    const children = [...imported.children]
    for (const child of children) drawLayer.addChild(child)
    imported.remove()
  } else {
    drawLayer.addChild(imported)
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

/**
 * Temporarily hide non-selected items (and overlays), run callback, then restore.
 */
function withSelectedOnly<T>(selectedIds: string[], fn: (drawLayer: paper.Layer) => T): T {
  const drawLayer = getDrawLayer()
  const hidden: paper.Item[] = []
  for (const child of drawLayer.children) {
    if (child.visible) {
      const sid = child.data?.shapeId
      if (isExportExcluded(child) || !sid || !selectedIds.includes(sid)) {
        child.visible = false
        hidden.push(child)
      }
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

export function exportSelectedSVG(selectedIds: string[]): string {
  return withSelectedOnly(selectedIds, (drawLayer) => {
    return drawLayer.exportSVG({ asString: true }) as string
  })
}

export function exportSelectedPNG(selectedIds: string[], scale = 2): Promise<Blob> {
  return new Promise((resolve) => {
    withSelectedOnly(selectedIds, (drawLayer) => {
      const raster = drawLayer.rasterize({ resolution: 72 * scale, insert: false })
      const canvas = raster.canvas as HTMLCanvasElement
      canvas.toBlob((blob) => {
        resolve(blob!)
      }, 'image/png')
    })
  })
}

// --- Image Trace (Advanced Pipeline) ---

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

/** Separable Gaussian blur on a Float32Array field */
function gaussianBlur(field: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return field
  const sigma = radius / 2
  const ks = Math.ceil(sigma * 3) | 0
  const size = ks * 2 + 1
  const kernel = new Float32Array(size)
  let sum = 0
  for (let i = 0; i < size; i++) {
    const x = i - ks
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma))
    sum += kernel[i]
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum

  // Horizontal pass
  const temp = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -ks; k <= ks; k++) {
        const sx = Math.min(w - 1, Math.max(0, x + k))
        v += field[y * w + sx] * kernel[k + ks]
      }
      temp[y * w + x] = v
    }
  }
  // Vertical pass
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = -ks; k <= ks; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + k))
        v += temp[sy * w + x] * kernel[k + ks]
      }
      out[y * w + x] = v
    }
  }
  return out
}

/** Extract scalar field from RGBA pixels by channel */
function extractScalarField(
  pixels: Uint8ClampedArray, w: number, h: number,
  channel: TraceChannel, invert: boolean,
): Float32Array {
  const field = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4] / 255
    const g = pixels[i * 4 + 1] / 255
    const b = pixels[i * 4 + 2] / 255
    const a = pixels[i * 4 + 3] / 255
    let v: number
    switch (channel) {
      case 'alpha': v = a; break
      case 'luminance': v = 0.299 * r + 0.587 * g + 0.114 * b; break
      case 'red': v = r; break
      case 'green': v = g; break
      case 'blue': v = b; break
    }
    field[i] = invert ? 1 - v : v
  }
  return field
}

/** Signed area via shoelace formula. Positive = CCW (outer), Negative = CW (hole) */
function signedArea(pts: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y)
  }
  return a / 2
}

/** Marching squares: extract iso-contours from a 2D scalar field. */
function extractContours(
  field: Float32Array, width: number, height: number, iso: number,
): { x: number; y: number }[][] {
  const lerp = (v1: number, v2: number) =>
    Math.abs(v2 - v1) < 1e-10 ? 0.5 : (iso - v1) / (v2 - v1)

  type Pt = { x: number; y: number }
  type Seg = [Pt, Pt]
  const segments: Seg[] = []

  for (let j = 0; j < height - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const tl = field[j * width + i]
      const tr = field[j * width + i + 1]
      const br = field[(j + 1) * width + i + 1]
      const bl = field[(j + 1) * width + i]

      let c = 0
      if (tl >= iso) c |= 1
      if (tr >= iso) c |= 2
      if (br >= iso) c |= 4
      if (bl >= iso) c |= 8
      if (c === 0 || c === 15) continue

      const top: Pt = { x: i + lerp(tl, tr), y: j }
      const right: Pt = { x: i + 1, y: j + lerp(tr, br) }
      const bottom: Pt = { x: i + lerp(bl, br), y: j + 1 }
      const left: Pt = { x: i, y: j + lerp(tl, bl) }

      switch (c) {
        case 1: segments.push([left, top]); break
        case 2: segments.push([top, right]); break
        case 3: segments.push([left, right]); break
        case 4: segments.push([right, bottom]); break
        case 5: {
          const ctr = (tl + tr + br + bl) / 4
          if (ctr >= iso) { segments.push([left, top]); segments.push([right, bottom]) }
          else { segments.push([left, bottom]); segments.push([top, right]) }
          break
        }
        case 6: segments.push([top, bottom]); break
        case 7: segments.push([left, bottom]); break
        case 8: segments.push([bottom, left]); break
        case 9: segments.push([bottom, top]); break
        case 10: {
          const ctr = (tl + tr + br + bl) / 4
          if (ctr >= iso) { segments.push([top, right]); segments.push([bottom, left]) }
          else { segments.push([top, left]); segments.push([bottom, right]) }
          break
        }
        case 11: segments.push([bottom, right]); break
        case 12: segments.push([right, left]); break
        case 13: segments.push([right, top]); break
        case 14: segments.push([top, left]); break
      }
    }
  }
  if (segments.length === 0) return []

  // Chain segments into closed contours
  const key = (p: Pt) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`
  const adj = new Map<string, number[]>()
  for (let si = 0; si < segments.length; si++) {
    for (const pt of segments[si]) {
      const k = key(pt)
      if (!adj.has(k)) adj.set(k, [])
      adj.get(k)!.push(si)
    }
  }

  const used = new Set<number>()
  const contours: Pt[][] = []
  for (let si = 0; si < segments.length; si++) {
    if (used.has(si)) continue
    const contour: Pt[] = [segments[si][0]]
    let end = segments[si][1]
    used.add(si)
    while (true) {
      contour.push(end)
      const k = key(end)
      const next = (adj.get(k) || []).find((i) => !used.has(i))
      if (next === undefined) break
      used.add(next)
      const seg = segments[next]
      end = key(seg[0]) === k ? seg[1] : seg[0]
    }
    if (contour.length >= 4) contours.push(contour)
  }
  return contours
}

/** Load image and extract pixel data at a scaled resolution. */
export function loadImagePixels(
  img: HTMLImageElement, maxDim = 800,
): { pixels: Uint8ClampedArray; sw: number; sh: number; ds: number } {
  let sw = img.naturalWidth, sh = img.naturalHeight
  const ds = Math.min(1, maxDim / Math.max(sw, sh))
  sw = Math.round(sw * ds); sh = Math.round(sh * ds)
  const offscreen = document.createElement('canvas')
  offscreen.width = sw; offscreen.height = sh
  const ctx = offscreen.getContext('2d')!
  ctx.drawImage(img, 0, 0, sw, sh)
  return { pixels: ctx.getImageData(0, 0, sw, sh).data, sw, sh, ds }
}

/**
 * Advanced trace pipeline: returns structured contour metadata.
 * Does NOT create Paper.js paths — that's done separately in createPathsFromTrace.
 */
export function advancedTrace(
  pixels: Uint8ClampedArray, sw: number, sh: number, ds: number,
  options: TraceOptions,
): TraceResult {
  const { channel, threshold, blurRadius, minArea, invert } = options
  const upscale = 1 / ds

  // 1. Extract scalar field from chosen channel
  let field = extractScalarField(pixels, sw, sh, channel, invert)

  // 2. Optional Gaussian blur for noise reduction
  if (blurRadius > 0) {
    field = gaussianBlur(field, sw, sh, blurRadius)
  }

  // 3. Marching squares
  const rawContours = extractContours(field, sw, sh, threshold / 255)

  // 4. Build structured contour data with area, winding, bounds
  const contours: ContourData[] = []
  let contourId = 0
  for (const pts of rawContours) {
    // Scale points to original image coords
    const scaled = pts.map(p => ({ x: p.x * upscale, y: p.y * upscale }))
    const sa = signedArea(scaled)
    const area = Math.abs(sa)
    if (area < minArea) continue

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of scaled) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }

    contours.push({
      id: contourId++,
      points: scaled,
      area,
      bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      isHole: sa > 0, // CW = positive signed area = hole
      enabled: true,
      pointCount: scaled.length,
    })
  }

  // Sort: outer contours (large) first, holes after
  contours.sort((a, b) => {
    if (a.isHole !== b.isHole) return a.isHole ? 1 : -1
    return b.area - a.area
  })

  return {
    contours,
    imageWidth: Math.round(sw / ds),
    imageHeight: Math.round(sh / ds),
    scaledWidth: sw,
    scaledHeight: sh,
    downscale: ds,
  }
}

/**
 * Materialize Paper.js paths from trace contours and add to the draw layer.
 * Only creates paths from enabled contours.
 */
export function createPathsFromTrace(
  traceResult: TraceResult,
  style: ShapeStyle,
  simplifyTolerance: number,
  pathOffset: number,
  _cornerAngle: number,
): paper.PathItem | null {
  const enabledContours = traceResult.contours.filter(c => c.enabled)
  if (enabledContours.length === 0) return null

  const drawLayer = getDrawLayer()
  drawLayer.activate()

  // Build all sub-paths detached (insert: false) first
  const paths: paper.Path[] = []
  for (const contour of enabledContours) {
    if (contour.points.length < 3) continue
    const path = new paper.Path({ insert: false })
    for (const pt of contour.points) {
      path.add(new paper.Point(pt.x, pt.y))
    }
    path.closePath()
    if (simplifyTolerance > 0) path.simplify(simplifyTolerance)

    if (pathOffset !== 0) {
      const offsetPath = PaperOffset.offsetPath(path, pathOffset)
      if (offsetPath) { paths.push(offsetPath); continue }
    }
    paths.push(path)
  }
  if (paths.length === 0) return null

  // Combine into a single item — keep everything detached until the end
  let result: paper.PathItem
  if (paths.length === 1) {
    result = paths[0]
  } else {
    result = new paper.CompoundPath({ children: paths, insert: false })
  }

  // NOW insert the final item into the draw layer
  drawLayer.addChild(result)

  // ----- fit & center onto the visible canvas -----
  const view = getScope().view
  // view.viewSize is in CSS-pixel coords; view.center is in project coords.
  // Because we set view.scaling = (dpr, dpr), project coords = CSS coords
  // (viewToProject just divides by scaling, but scaling is already baked in).
  // Use viewSize for the fit calculation so the math is DPI-independent.
  const vw = view.viewSize.width
  const vh = view.viewSize.height

  const sb = result.bounds
  const shapeMax = Math.max(sb.width, sb.height)
  if (shapeMax > 0.5) {
    const maxFit = Math.min(vw, vh) * 0.6
    const fitScale = maxFit / shapeMax
    result.scale(fitScale)
  }

  // Place at the center of the visible viewport
  result.position = view.center

  applyStyle(result, style)
  return result
}

// --- Save / Load Project ---

export interface ProjectFile {
  version: 1
  canvasJson: string
  shapes: import('./types').ShapeItem[]
  canvasBgColor: string
}

/** Serialize the entire project (draw layer + shape metadata) to a downloadable JSON string. */
export function saveProjectJSON(shapes: import('./types').ShapeItem[], canvasBgColor: string): string {
  const canvasJson = exportHistoryJSON()
  const project: ProjectFile = { version: 1, canvasJson, shapes, canvasBgColor }
  return JSON.stringify(project, null, 2)
}

/** Load a project file and restore the draw layer + return shape metadata. */
export function loadProjectJSON(jsonStr: string): { shapes: import('./types').ShapeItem[]; canvasBgColor: string } {
  const project: ProjectFile = JSON.parse(jsonStr)
  if (project.version !== 1 || !project.canvasJson || !project.shapes) {
    throw new Error('Invalid Shape Forge project file')
  }
  replaceDrawLayerFromHistoryJSON(project.canvasJson)
  return { shapes: project.shapes, canvasBgColor: project.canvasBgColor ?? '#0d0d1a' }
}

/** Simple path offset using Paper.js — expand or contract a path */
const PaperOffset = {
  offsetPath(path: paper.Path, offset: number): paper.Path | null {
    try {
      // Use normal-based offset: move each point along its normal
      const result = path.clone({ insert: false }) as paper.Path
      for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i]
        const normal = result.getNormalAt(result.getOffsetOf(seg.point))
        if (normal) {
          seg.point = seg.point.add(normal.multiply(offset))
        }
      }
      result.simplify(1)
      return result
    } catch {
      return null
    }
  },
}

