import React, { useRef, useEffect, useCallback, useState } from 'react'
import paper from 'paper'
import { useStore } from '../store'
import {
  initEngine, getScope, getProject, getDrawLayer, nextId, applyStyle, drawArrowMarkers,
  createRectangle, createCircle, createRoundedRect, createPolygon, createStar, createLine,
} from '../engine'
import type { ShapeItem, HistoryEntry } from '../types'

/** Constrain drag endpoint so width === height (perfect square / circle when Shift held). */
function constrainDrag(from: paper.Point, to: paper.Point): paper.Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  return new paper.Point(
    from.x + size * Math.sign(dx || 1),
    from.y + size * Math.sign(dy || 1),
  )
}

/** Snap a point to the nearest grid intersection. */
function snapPointToGrid(pt: paper.Point, gridSize: number): paper.Point {
  return new paper.Point(
    Math.round(pt.x / gridSize) * gridSize,
    Math.round(pt.y / gridSize) * gridSize,
  )
}

/** Walk up from a hit-test result to find the item with a shapeId, stopping at the layer boundary. */
function hitTestShape(drawLayer: paper.Layer, hitResult: paper.HitResult | null): paper.Item | null {
  let item: paper.Item | null = hitResult?.item ?? null
  while (item && !item.data?.shapeId) {
    item = item.parent
    if (item === drawLayer) return null
  }
  return item
}

export default function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = useRef<paper.PaperScope | null>(null)
  const gridLayerRef = useRef<paper.Layer | null>(null)
  const dragStartRef = useRef<paper.Point | null>(null)
  const previewRef = useRef<paper.Item | null>(null)
  const selectedItemRef = useRef<paper.Item | null>(null)
  const dragOffsetRef = useRef<paper.Point | null>(null)
  const isDraggingShapeRef = useRef(false)
  const freehandPathRef = useRef<paper.Path | null>(null)
  const altDragClonedRef = useRef(false)
  const measureStartRef = useRef<paper.Point | null>(null)
  const measureOverlayRef = useRef<paper.Group | null>(null)
  const penDraggingRef = useRef(false)
  const penLastPointRef = useRef<paper.Point | null>(null)
  const handleGuideRef = useRef<paper.Group | null>(null)
  const penCloseIndicatorRef = useRef<paper.Item | null>(null)
  const selectionOverlayRef = useRef<paper.Group | null>(null)
  const nodeOverlayRef = useRef<paper.Group | null>(null)
  const draggingNodeRef = useRef<{ segIndex: number; part: 'point' | 'handleIn' | 'handleOut' } | null>(null)
  const selectedNodeRef = useRef<number | null>(null) // currently selected segment index in node edit mode
  // Canvas navigation refs
  const panStartRef = useRef<paper.Point | null>(null)
  const panViewCenterRef = useRef<paper.Point | null>(null)
  const isPanningRef = useRef(false)
  // Marquee selection refs
  const marqueeStartRef = useRef<paper.Point | null>(null)
  const marqueeRectRef = useRef<paper.Path.Rectangle | null>(null)
  // Smart guide overlay ref
  const smartGuideRef = useRef<paper.Group | null>(null)
  // Ruler canvas refs
  const hRulerRef = useRef<HTMLCanvasElement>(null)
  const vRulerRef = useRef<HTMLCanvasElement>(null)
  // Node edit hover cursor
  const [nodeHoverCursor, setNodeHoverCursor] = useState<string | null>(null)
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  // Dimension tooltip (shown during shape drawing)
  const [dimTooltip, setDimTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  // Resize handle drag state
  const resizeDragRef = useRef<{
    handle: string // 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r'
    anchorPoint: paper.Point
    startBounds: paper.Rectangle
    startPoint: paper.Point
  } | null>(null)
  // Paste callback ref (avoids stale closure in paste event listener)
  const handlePasteRef = useRef<() => void>(() => {})
  // Rotation handle drag state
  const rotateDragRef = useRef<{
    center: paper.Point      // rotation center (combined bounds center)
    startAngle: number       // angle from center to initial mouse position (radians)
    origData: Map<string, { rotation: number; position: paper.Point }> // original state per shape
    lastAppliedAngle: number // last applied delta angle (degrees)
  } | null>(null)

  const activeTool = useStore((s) => s.activeTool)
  const currentStyle = useStore((s) => s.currentStyle)
  const addShape = useStore((s) => s.addShape)
  const setSelectedShapeIds = useStore((s) => s.setSelectedShapeIds)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)
  const shapes = useStore((s) => s.shapes)
  const pushHistory = useStore((s) => s.pushHistory)
  const penPath = useStore((s) => s.penPath)
  const setPenPath = useStore((s) => s.setPenPath)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const editMode = useStore((s) => s.editMode)
  const editingShapeId = useStore((s) => s.editingShapeId)
  const enterNodeEdit = useStore((s) => s.enterNodeEdit)
  const exitNodeEdit = useStore((s) => s.exitNodeEdit)
  const spaceHeld = useStore((s) => s.spaceHeld)
  const zoomLevel = useStore((s) => s.zoomLevel)
  const canvasBgColor = useStore((s) => s.canvasBgColor)
  const showCheckerboard = useStore((s) => s.showCheckerboard)

  // Refs to always have latest values in event handlers
  const activeToolRef = useRef(activeTool)
  const currentStyleRef = useRef(currentStyle)
  const penPathRef = useRef(penPath)
  const editModeRef = useRef(editMode)
  const editingShapeIdRef = useRef(editingShapeId)
  const spaceHeldRef = useRef(spaceHeld)
  activeToolRef.current = activeTool
  currentStyleRef.current = currentStyle
  penPathRef.current = penPath
  editModeRef.current = editMode
  editingShapeIdRef.current = editingShapeId
  spaceHeldRef.current = spaceHeld

  const saveHistory = useCallback((desc: string) => {
    const project = getProject()
    const json = project.exportJSON()
    pushHistory({ json, shapes: useStore.getState().shapes, description: desc })
  }, [pushHistory])

  /** Remove any active smart-guide overlay lines */
  const clearSmartGuides = useCallback(() => {
    if (smartGuideRef.current) {
      smartGuideRef.current.remove()
      smartGuideRef.current = null
    }
  }, [])

  /**
   * Draw smart alignment guides when dragging a shape.
   * Compares the dragged item's bounds against all other shapes and draws
   * magenta guide lines for edges/centers that align within a tolerance.
   * Returns the snapped position adjustment (dx, dy).
   */
  const drawSmartGuides = useCallback((draggedIds: string[]): paper.Point => {
    clearSmartGuides()
    const state = useStore.getState()
    if (!state.showSmartGuides) return new paper.Point(0, 0)

    const drawLayer = getDrawLayer()
    const scope = scopeRef.current
    if (!scope) return new paper.Point(0, 0)

    // Gather bounds of all dragged items as one combined rect
    let dragBounds: paper.Rectangle | null = null
    for (const sid of draggedIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (item) {
        dragBounds = dragBounds ? dragBounds.unite(item.bounds) : item.bounds.clone()
      }
    }
    if (!dragBounds) return new paper.Point(0, 0)

    const TOLERANCE = 5 / scope.view.zoom // 5 screen pixels
    const guides: paper.Item[] = []
    let snapDx = 0
    let snapDy = 0
    let foundX = false
    let foundY = false

    // Collect anchor values from other shapes
    for (const shape of state.shapes) {
      if (draggedIds.includes(shape.id)) continue
      const item = drawLayer.children.find((c) => c.data?.shapeId === shape.id)
      if (!item || !item.visible) continue
      const ob = item.bounds

      // Horizontal alignment checks (X axis)
      const xChecks = [
        { drag: dragBounds.left, other: ob.left },
        { drag: dragBounds.left, other: ob.right },
        { drag: dragBounds.left, other: ob.center.x },
        { drag: dragBounds.right, other: ob.left },
        { drag: dragBounds.right, other: ob.right },
        { drag: dragBounds.right, other: ob.center.x },
        { drag: dragBounds.center.x, other: ob.left },
        { drag: dragBounds.center.x, other: ob.right },
        { drag: dragBounds.center.x, other: ob.center.x },
      ]
      for (const { drag: dv, other: ov } of xChecks) {
        if (!foundX && Math.abs(dv - ov) < TOLERANCE) {
          snapDx = ov - dv
          foundX = true
          // Draw vertical guide line
          const minY = Math.min(dragBounds.top, ob.top) - 20
          const maxY = Math.max(dragBounds.bottom, ob.bottom) + 20
          guides.push(new paper.Path.Line({
            from: new paper.Point(ov, minY),
            to: new paper.Point(ov, maxY),
            strokeColor: new paper.Color('#ff00ff'),
            strokeWidth: 1 / scope.view.zoom,
            dashArray: [4 / scope.view.zoom, 3 / scope.view.zoom],
          }))
          break
        }
      }

      // Vertical alignment checks (Y axis)
      const yChecks = [
        { drag: dragBounds.top, other: ob.top },
        { drag: dragBounds.top, other: ob.bottom },
        { drag: dragBounds.top, other: ob.center.y },
        { drag: dragBounds.bottom, other: ob.top },
        { drag: dragBounds.bottom, other: ob.bottom },
        { drag: dragBounds.bottom, other: ob.center.y },
        { drag: dragBounds.center.y, other: ob.top },
        { drag: dragBounds.center.y, other: ob.bottom },
        { drag: dragBounds.center.y, other: ob.center.y },
      ]
      for (const { drag: dv, other: ov } of yChecks) {
        if (!foundY && Math.abs(dv - ov) < TOLERANCE) {
          snapDy = ov - dv
          foundY = true
          // Draw horizontal guide line
          const minX = Math.min(dragBounds.left, ob.left) - 20
          const maxX = Math.max(dragBounds.right, ob.right) + 20
          guides.push(new paper.Path.Line({
            from: new paper.Point(minX, ov),
            to: new paper.Point(maxX, ov),
            strokeColor: new paper.Color('#ff00ff'),
            strokeWidth: 1 / scope.view.zoom,
            dashArray: [4 / scope.view.zoom, 3 / scope.view.zoom],
          }))
          break
        }
      }
    }

    if (guides.length > 0) {
      const group = new paper.Group(guides)
      group.data = { isOverlay: true }
      smartGuideRef.current = group
    }

    return new paper.Point(snapDx, snapDy)
  }, [clearSmartGuides])

  const drawSelectionOverlay = useCallback(() => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()

    // Remove old selection overlay
    if (selectionOverlayRef.current) {
      selectionOverlayRef.current.remove()
      selectionOverlayRef.current = null
    }

    const state = useStore.getState()
    const sids = state.selectedShapeIds
    if (sids.length === 0) return
    if (editModeRef.current === 'node') return // don't show resize handles in node edit mode

    const drawLayer = getDrawLayer()

    const group = new paper.Group()
    group.data = { isOverlay: true }

    // Compute combined bounds for all selected shapes
    let combinedBounds: paper.Rectangle | null = null
    for (const sid of sids) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (!item) continue
      combinedBounds = combinedBounds ? combinedBounds.unite(item.bounds) : item.bounds.clone()
    }
    if (!combinedBounds) return

    const b = combinedBounds.expand(4)
    // Dashed outline
    const rect = new paper.Path.Rectangle({
      rectangle: b,
      strokeColor: new paper.Color('#6a6aff'),
      strokeWidth: 1,
      dashArray: [4, 3],
      fillColor: null as any,
    })
    rect.data = { isOverlay: true }
    group.addChild(rect)

    // Resize handles — 8 positions
    const zoom = scopeRef.current?.view.zoom ?? 1
    const hs = 5 / zoom // handle half-size in project coords
    const handlePositions: { id: string; pt: paper.Point }[] = [
      { id: 'tl', pt: b.topLeft },
      { id: 'tr', pt: b.topRight },
      { id: 'bl', pt: b.bottomLeft },
      { id: 'br', pt: b.bottomRight },
      { id: 't', pt: new paper.Point(b.center.x, b.top) },
      { id: 'b', pt: new paper.Point(b.center.x, b.bottom) },
      { id: 'l', pt: new paper.Point(b.left, b.center.y) },
      { id: 'r', pt: new paper.Point(b.right, b.center.y) },
    ]

    for (const h of handlePositions) {
      const handle = new paper.Path.Rectangle({
        point: new paper.Point(h.pt.x - hs, h.pt.y - hs),
        size: new paper.Size(hs * 2, hs * 2),
        fillColor: new paper.Color('#ffffff'),
        strokeColor: new paper.Color('#6a6aff'),
        strokeWidth: 1 / zoom,
      })
      handle.data = { isOverlay: true, resizeHandle: h.id }
      group.addChild(handle)
    }

    // Rotation handle — circle above top-center, connected by a line
    const rotLineLen = 25 / zoom
    const rotTopPt = new paper.Point(b.center.x, b.top)
    const rotHandlePt = new paper.Point(b.center.x, b.top - rotLineLen)
    const rotLine = new paper.Path.Line({
      from: rotTopPt,
      to: rotHandlePt,
      strokeColor: new paper.Color('#6a6aff'),
      strokeWidth: 1 / zoom,
    })
    rotLine.data = { isOverlay: true }
    group.addChild(rotLine)
    const rotCircle = new paper.Path.Circle({
      center: rotHandlePt,
      radius: 5 / zoom,
      fillColor: new paper.Color('#ffffff'),
      strokeColor: new paper.Color('#6a6aff'),
      strokeWidth: 1 / zoom,
    })
    rotCircle.data = { isOverlay: true, rotateHandle: true }
    group.addChild(rotCircle)

    selectionOverlayRef.current = group
  }, [])

  // Trigger selection overlay redraw when selection/shapes/editMode change
  useEffect(() => {
    drawSelectionOverlay()
  }, [selectedShapeIds, shapes, editMode, drawSelectionOverlay])

  /** Resize canvas to fill container at correct DPI */
  const resizeCanvas = useCallback((scope: paper.PaperScope) => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth
    const h = container.clientHeight

    // Set actual pixel dimensions
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    // CSS dimensions match container
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'

    // Tell Paper.js about the new size
    scope.view.viewSize = new paper.Size(w, h)
    scope.view.scaling = new paper.Point(dpr, dpr)

    drawGrid(scope, gridLayerRef.current)
    drawRulers(scope, hRulerRef.current, vRulerRef.current)
    drawSelectionOverlay()
  }, [drawSelectionOverlay])

  useEffect(() => {
    if (!canvasRef.current || scopeRef.current) return
    const scope = initEngine(canvasRef.current)
    scopeRef.current = scope

    // Create a dedicated grid layer behind the main layer
    const gridLayer = new paper.Layer()
    gridLayer.name = 'grid'
    gridLayer.locked = true
    gridLayerRef.current = gridLayer

    // Create the main drawing layer and activate it
    const drawLayer = new paper.Layer()
    drawLayer.name = 'draw'
    drawLayer.activate()

    // Initial sizing
    resizeCanvas(scope)

    // Save initial state
    saveHistory('Initial')

    // ResizeObserver for robust container-based resize
    const ro = new ResizeObserver(() => {
      resizeCanvas(scope)
    })
    ro.observe(containerRef.current!)
    // Also observe ruler canvases so they redraw when their flex size changes
    if (hRulerRef.current) ro.observe(hRulerRef.current)
    if (vRulerRef.current) ro.observe(vRulerRef.current)

    // Window resize fires synchronously before paint on every resize frame,
    // ensuring rulers redraw before the browser can render a stretched frame.
    const onWindowResize = () => {
      drawRulers(scope, hRulerRef.current, vRulerRef.current)
    }
    window.addEventListener('resize', onWindowResize)

    // Also handle DPI changes (e.g. dragging between monitors)
    const mqDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onDprChange = () => resizeCanvas(scope)
    mqDpr.addEventListener('change', onDprChange)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
      mqDpr.removeEventListener('change', onDprChange)
    }
  }, [saveHistory, resizeCanvas])

  // Redraw grid when snap-to-grid settings change
  const snapToGrid = useStore((s) => s.snapToGrid)
  const gridSize = useStore((s) => s.gridSize)
  useEffect(() => {
    const scope = scopeRef.current
    if (scope) {
      drawGrid(scope, gridLayerRef.current)
    }
  }, [snapToGrid, gridSize])

  /** Convert mouse event to Paper.js project coordinates */
  const toProjectPoint = useCallback((e: React.MouseEvent): paper.Point => {
    const scope = scopeRef.current!
    const rect = canvasRef.current!.getBoundingClientRect()
    const viewPt = new paper.Point(e.clientX - rect.left, e.clientY - rect.top)
    return scope.view.viewToProject(viewPt)
  }, [])

  /** Ensure the draw layer is active (not the grid layer) */
  const activateDrawLayer = useCallback(() => {
    getDrawLayer().activate()
  }, [])

  // Draw node editing overlay (segment points + bezier handles)
  const drawNodeOverlay = useCallback(() => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()

    const zoom = scope.view.zoom ?? 1

    // Remove old node overlay
    if (nodeOverlayRef.current) {
      nodeOverlayRef.current.remove()
      nodeOverlayRef.current = null
    }

    const sid = editingShapeIdRef.current
    if (!sid || editModeRef.current !== 'node') return

    const drawLayer = getDrawLayer()

    const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
    if (!item || !(item instanceof paper.Path || item instanceof paper.CompoundPath)) return

    const group = new paper.Group()
    group.data = { isOverlay: true, isNodeOverlay: true }

    const paths: paper.Path[] = item instanceof paper.CompoundPath
      ? (item.children as paper.Path[])
      : [item as paper.Path]

    // Draw a thin outline of the path for clarity
    for (const p of paths) {
      const outline = p.clone({ insert: false }) as paper.Path
      outline.strokeColor = new paper.Color('#6a6aff')
      outline.strokeWidth = 1 / zoom
      outline.fillColor = null as any
      outline.opacity = 0.5
      outline.dashArray = [6 / zoom, 3 / zoom]
      outline.data = { isOverlay: true }
      group.addChild(outline)
    }

    const selIdx = selectedNodeRef.current
    let globalIdx = 0
    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi]
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        const pt = seg.point
        const idx = globalIdx++
        const isSelected = idx === selIdx
        const isSmooth = seg.handleIn.length > 0 || seg.handleOut.length > 0

        // Draw bezier handle lines and dots (always for selected, only if present for others)
        if (seg.handleIn && seg.handleIn.length > 0) {
          const hPt = pt.add(seg.handleIn)
          const line = new paper.Path.Line({
            from: pt, to: hPt,
            strokeColor: new paper.Color(isSelected ? '#ffaa00' : '#ff6600'),
            strokeWidth: 1 / zoom,
            dashArray: [3 / zoom, 3 / zoom],
          })
          line.data = { isOverlay: true }
          group.addChild(line)
          const dot = new paper.Path.Circle({
            center: hPt, radius: 4 / zoom,
            fillColor: new paper.Color(isSelected ? '#ffaa00' : '#ff6600'),
            strokeColor: new paper.Color('#ffffff'),
            strokeWidth: 0.5 / zoom,
          })
          dot.data = { isOverlay: true, nodeType: 'handleIn', segIndex: idx, pathIndex: pi }
          group.addChild(dot)
        }

        if (seg.handleOut && seg.handleOut.length > 0) {
          const hPt = pt.add(seg.handleOut)
          const line = new paper.Path.Line({
            from: pt, to: hPt,
            strokeColor: new paper.Color(isSelected ? '#ffaa00' : '#ff6600'),
            strokeWidth: 1 / zoom,
            dashArray: [3 / zoom, 3 / zoom],
          })
          line.data = { isOverlay: true }
          group.addChild(line)
          const dot = new paper.Path.Circle({
            center: hPt, radius: 4 / zoom,
            fillColor: new paper.Color(isSelected ? '#ffaa00' : '#ff6600'),
            strokeColor: new paper.Color('#ffffff'),
            strokeWidth: 0.5 / zoom,
          })
          dot.data = { isOverlay: true, nodeType: 'handleOut', segIndex: idx, pathIndex: pi }
          group.addChild(dot)
        }

        // Draw segment point — square for corner, circle for smooth, highlighted if selected
        const nodeSize = (isSelected ? 6 : 4) / zoom
        if (isSmooth) {
          const circle = new paper.Path.Circle({
            center: pt,
            radius: nodeSize,
            fillColor: new paper.Color(isSelected ? '#ffcc00' : '#ffffff'),
            strokeColor: new paper.Color(isSelected ? '#ff8800' : '#6a6aff'),
            strokeWidth: (isSelected ? 2 : 1.5) / zoom,
          })
          circle.data = { isOverlay: true, nodeType: 'point', segIndex: idx, pathIndex: pi }
          group.addChild(circle)
        } else {
          const square = new paper.Path.Rectangle({
            point: new paper.Point(pt.x - nodeSize, pt.y - nodeSize),
            size: new paper.Size(nodeSize * 2, nodeSize * 2),
            fillColor: new paper.Color(isSelected ? '#ffcc00' : '#ffffff'),
            strokeColor: new paper.Color(isSelected ? '#ff8800' : '#6a6aff'),
            strokeWidth: (isSelected ? 2 : 1.5) / zoom,
          })
          square.data = { isOverlay: true, nodeType: 'point', segIndex: idx, pathIndex: pi }
          group.addChild(square)
        }
      }
    }

    nodeOverlayRef.current = group
  }, [])

  // Mouse handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setContextMenu(null) // close context menu on any click
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()
    activateDrawLayer()

    // --- Pan: Space+click OR middle-click ---
    if (spaceHeldRef.current || e.button === 1) {
      e.preventDefault()
      isPanningRef.current = true
      const rect = canvasRef.current!.getBoundingClientRect()
      panStartRef.current = new paper.Point(e.clientX - rect.left, e.clientY - rect.top)
      panViewCenterRef.current = scope.view.center.clone()
      return
    }

    const viewPoint = toProjectPoint(e)
    const tool = activeToolRef.current

    // Node edit mode: check if clicking a node handle, path edge, or outside
    if (editModeRef.current === 'node' && tool === 'select') {
	    const zoom = scope.view.zoom ?? 1
      const overlay = nodeOverlayRef.current
      if (overlay) {
	      const hitTol = 10 / zoom
	      const hitResult = overlay.hitTest(viewPoint, { fill: true, tolerance: hitTol })
        if (hitResult?.item?.data?.nodeType) {
          const { nodeType, segIndex } = hitResult.item.data
          // Select this node
          if (nodeType === 'point') {
            selectedNodeRef.current = segIndex
          }
          draggingNodeRef.current = { segIndex, part: nodeType }
          dragStartRef.current = viewPoint
          drawNodeOverlay()
          return
        }
      }

      // Check if clicking on the path edge (stroke) — add a new node
      const sid = editingShapeIdRef.current
      const drawLayer = getDrawLayer()
      if (sid) {
        const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
        if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
	        const strokeTol = 8 / zoom
	        const strokeHit = item.hitTest(viewPoint, { stroke: true, tolerance: strokeTol })
          if (strokeHit && strokeHit.type === 'stroke' && strokeHit.location) {
            // Insert a new segment at the hit location on the curve
            const path = strokeHit.location.path
            const curveIdx = strokeHit.location.index
            const t = strokeHit.location.time ?? strokeHit.location.offset / strokeHit.location.curve.length
            const curve = path.curves[curveIdx]
            if (curve) {
              curve.divideAtTime(t)
              saveHistory('Add node')
              // Recompute selected index: new segment is at curveIdx + 1 in its sub-path
              // Compute the global index
              const paths: paper.Path[] = item instanceof paper.CompoundPath
                ? (item.children as paper.Path[]) : [item as paper.Path]
              let baseIdx = 0
              for (const p of paths) {
                if (p === path) break
                baseIdx += p.segments.length
              }
              selectedNodeRef.current = baseIdx + curveIdx + 1
              drawNodeOverlay()
              return
            }
          }
        }
      }

      // Clicked outside nodes and path edge — check if still on the shape
	    const shapeTol = 8 / zoom
	    const hitResult = drawLayer.hitTest(viewPoint, { fill: true, stroke: true, tolerance: shapeTol })
      const hitItem = hitTestShape(drawLayer, hitResult)
      if (!hitItem || hitItem.data?.shapeId !== editingShapeIdRef.current) {
        selectedNodeRef.current = null
        useStore.getState().exitNodeEdit()
      } else {
        // Clicked on shape fill but not a node — deselect node
        selectedNodeRef.current = null
        drawNodeOverlay()
      }
      return
    }

    if (tool === 'pen') {
      handlePenDown(viewPoint)
      return
    }

    if (tool === 'select') {
      // Check if clicking on a resize or rotate handle first
      if (selectionOverlayRef.current) {
        const handleHit = selectionOverlayRef.current.hitTest(viewPoint, { fill: true, tolerance: 8 / (scope.view.zoom ?? 1) })

        // Rotation handle check
        if (handleHit?.item?.data?.rotateHandle) {
          const drawLayer = getDrawLayer()
          let combinedBounds: paper.Rectangle | null = null
          for (const sid of useStore.getState().selectedShapeIds) {
            const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
            if (item) combinedBounds = combinedBounds ? combinedBounds.unite(item.bounds) : item.bounds.clone()
          }
          if (combinedBounds) {
            const center = combinedBounds.center
            const startAngle = Math.atan2(viewPoint.y - center.y, viewPoint.x - center.x)
            const origData = new Map<string, { rotation: number; position: paper.Point }>()
            for (const sid of useStore.getState().selectedShapeIds) {
              const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
              if (item) origData.set(sid, { rotation: item.rotation, position: item.position.clone() })
            }
            rotateDragRef.current = { center, startAngle, origData, lastAppliedAngle: 0 }
            return
          }
        }

        // Resize handle check
        if (handleHit?.item?.data?.resizeHandle) {
          const handleId = handleHit.item.data.resizeHandle as string
          // Compute combined bounds for all selected shapes
          const drawLayer = getDrawLayer()
          let combinedBounds: paper.Rectangle | null = null
          for (const sid of useStore.getState().selectedShapeIds) {
            const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
            if (item) combinedBounds = combinedBounds ? combinedBounds.unite(item.bounds) : item.bounds.clone()
          }
          if (combinedBounds) {
            // Determine anchor point (opposite corner/edge)
            const anchorMap: Record<string, paper.Point> = {
              'tl': combinedBounds.bottomRight, 'tr': combinedBounds.bottomLeft,
              'bl': combinedBounds.topRight, 'br': combinedBounds.topLeft,
              't': new paper.Point(combinedBounds.center.x, combinedBounds.bottom),
              'b': new paper.Point(combinedBounds.center.x, combinedBounds.top),
              'l': new paper.Point(combinedBounds.right, combinedBounds.center.y),
              'r': new paper.Point(combinedBounds.left, combinedBounds.center.y),
            }
            resizeDragRef.current = {
              handle: handleId,
              anchorPoint: anchorMap[handleId],
              startBounds: combinedBounds.clone(),
              startPoint: viewPoint.clone(),
            }
            return
          }
        }
      }
      handleSelectDown(viewPoint, e.shiftKey)
      return
    }

    // --- Eyedropper tool: pick color from shape under cursor ---
    if (tool === 'eyedropper') {
      const drawLayer = getDrawLayer()
      const hitResult = drawLayer.hitTest(viewPoint, { fill: true, stroke: true, tolerance: 8 })
      const hitItem = hitTestShape(drawLayer, hitResult)
      if (hitItem) {
        const fillColor = hitItem.fillColor
        const strokeColor = hitItem.strokeColor
        const updates: Partial<import('../types').ShapeStyle> = {}
        if (fillColor) updates.fillColor = fillColor.toCSS(true)
        if (strokeColor) updates.strokeColor = strokeColor.toCSS(true)
        if (Object.keys(updates).length > 0) {
          useStore.getState().setCurrentStyle(updates)
        }
      }
      // Switch back to select tool after pick
      useStore.getState().setActiveTool('select')
      return
    }

    // Text tool: place text at click point
    if (tool === 'text') {
      const style = currentStyleRef.current
      const text = new paper.PointText({
        point: viewPoint,
        content: 'Text',
        fillColor: new paper.Color(style.fillColor || '#ffffff'),
        fontFamily: 'sans-serif',
        fontSize: 24,
        insert: true,
      })
      if (style.strokeWidth > 0) {
        text.strokeColor = new paper.Color(style.strokeColor)
        text.strokeWidth = style.strokeWidth
      }
      text.opacity = style.opacity
      const shapeId = nextId()
      text.data = { shapeId }
      const shapeItem: ShapeItem = {
        id: shapeId,
        name: `Text ${shapeId.split('_')[1]}`,
        paperItemId: text.id,
        style: { ...style, fillColor: style.fillColor || '#ffffff' },
        visible: true,
        locked: false,
        textContent: 'Text',
        fontSize: 24,
        fontFamily: 'sans-serif',
      }
      useStore.getState().addShape(shapeItem)
      useStore.getState().setSelectedShapeIds([shapeId])
      saveHistory('Place text')
      useStore.getState().setActiveTool('select')
      return
    }

    // Measure tool: click first point, then second point
    if (tool === 'measure') {
      if (!measureStartRef.current) {
        // First click: set start point
        measureStartRef.current = viewPoint
        // Draw a small dot at start
        if (measureOverlayRef.current) { measureOverlayRef.current.remove(); measureOverlayRef.current = null }
        const dot = new paper.Path.Circle({ center: viewPoint, radius: 4, fillColor: new paper.Color('#ff6600') })
        dot.data = { isOverlay: true }
        const grp = new paper.Group([dot])
        grp.data = { isOverlay: true }
        measureOverlayRef.current = grp
      } else {
        // Second click: draw measurement line + label
        const startPt = measureStartRef.current
        const endPt = viewPoint
        measureStartRef.current = null
        if (measureOverlayRef.current) { measureOverlayRef.current.remove(); measureOverlayRef.current = null }
        const dist = Math.round(startPt.getDistance(endPt) * 10) / 10
        const line = new paper.Path.Line({ from: startPt, to: endPt, strokeColor: new paper.Color('#ff6600'), strokeWidth: 1.5, dashArray: [6, 3] })
        line.data = { isOverlay: true }
        const midPt = startPt.add(endPt).divide(2)
        const label = new paper.PointText({ point: midPt.add(new paper.Point(0, -8)), content: `${dist} px`, fillColor: new paper.Color('#ff6600'), fontSize: 12, fontFamily: 'sans-serif', justification: 'center' })
        label.data = { isOverlay: true }
        const dotA = new paper.Path.Circle({ center: startPt, radius: 4, fillColor: new paper.Color('#ff6600') })
        dotA.data = { isOverlay: true }
        const dotB = new paper.Path.Circle({ center: endPt, radius: 4, fillColor: new paper.Color('#ff6600') })
        dotB.data = { isOverlay: true }
        const grp = new paper.Group([line, label, dotA, dotB])
        grp.data = { isOverlay: true }
        measureOverlayRef.current = grp
        // Auto-remove after 5 seconds
        setTimeout(() => {
          if (measureOverlayRef.current === grp) {
            grp.remove()
            measureOverlayRef.current = null
          }
        }, 5000)
      }
      return
    }

    // Freehand tool: start drawing path
    if (tool === 'freehand') {
      const style = currentStyleRef.current
      const path = new paper.Path({
        strokeColor: new paper.Color(style.strokeColor || '#ffffff'),
        strokeWidth: style.strokeWidth > 0 ? style.strokeWidth : 2,
        strokeCap: 'round',
        strokeJoin: 'round',
        fillColor: null as any,
      })
      path.add(viewPoint)
      freehandPathRef.current = path
      return
    }

    // Shape tools: start drag
    dragStartRef.current = viewPoint
  }, [toProjectPoint, activateDrawLayer, drawNodeOverlay, saveHistory])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()
    activateDrawLayer()

    // Update cursor position in store (for status bar)
    const viewPoint0 = toProjectPoint(e)
    useStore.getState().setCursorPosition(Math.round(viewPoint0.x), Math.round(viewPoint0.y))

    // --- Pan handling ---
    if (isPanningRef.current && panStartRef.current && panViewCenterRef.current) {
      const rect = canvasRef.current!.getBoundingClientRect()
      const now = new paper.Point(e.clientX - rect.left, e.clientY - rect.top)
      const delta = now.subtract(panStartRef.current)
      // Move view center opposite to mouse delta, accounting for zoom
      scope.view.center = panViewCenterRef.current.subtract(delta.divide(scope.view.zoom))
      drawGrid(scope, gridLayerRef.current)
      drawRulers(scope, hRulerRef.current, vRulerRef.current)
      drawSelectionOverlay()
      return
    }

    // --- Marquee selection ---
    if (marqueeStartRef.current && activeToolRef.current === 'select') {
      const viewPoint = toProjectPoint(e)
      if (marqueeRectRef.current) {
        marqueeRectRef.current.remove()
        marqueeRectRef.current = null
      }
      const r = new paper.Rectangle(marqueeStartRef.current, viewPoint)
      const rect = new paper.Path.Rectangle({
        rectangle: r,
        strokeColor: new paper.Color('#6a6aff'),
        strokeWidth: 1,
        dashArray: [4, 3],
        fillColor: new paper.Color(0.4, 0.4, 1, 0.08),
      })
      rect.data = { isOverlay: true }
      marqueeRectRef.current = rect
      return
    }

    // --- Freehand drawing ---
    if (freehandPathRef.current) {
      const viewPoint = toProjectPoint(e)
      freehandPathRef.current.add(viewPoint)
      return
    }

    const viewPoint = toProjectPoint(e)
    const tool = activeToolRef.current

    // Node edit mode: drag a segment point or handle
    if (editModeRef.current === 'node' && draggingNodeRef.current) {
      const sid = editingShapeIdRef.current
      if (!sid) return
      const drawLayer = getDrawLayer()
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (!item || !(item instanceof paper.Path || item instanceof paper.CompoundPath)) return

      const paths: paper.Path[] = item instanceof paper.CompoundPath
        ? (item.children as paper.Path[])
        : [item as paper.Path]

      const { segIndex, part } = draggingNodeRef.current
      // Find the segment across all sub-paths
      let seg: paper.Segment | null = null
      let count = 0
      for (const p of paths) {
        if (segIndex < count + p.segments.length) {
          seg = p.segments[segIndex - count]
          break
        }
        count += p.segments.length
      }
      if (!seg) return

      if (part === 'point') {
        seg.point = viewPoint
      } else if (part === 'handleIn') {
        const newHandleIn = viewPoint.subtract(seg.point)
        seg.handleIn = newHandleIn
        // Mirror opposite handle unless Alt is held (break symmetry)
        if (!e.altKey && seg.handleOut.length > 0) {
          seg.handleOut = newHandleIn.multiply(-1).normalize(seg.handleOut.length)
        }
      } else if (part === 'handleOut') {
        const newHandleOut = viewPoint.subtract(seg.point)
        seg.handleOut = newHandleOut
        // Mirror opposite handle unless Alt is held (break symmetry)
        if (!e.altKey && seg.handleIn.length > 0) {
          seg.handleIn = newHandleOut.multiply(-1).normalize(seg.handleIn.length)
        }
      }

      // Redraw node overlay
      drawNodeOverlay()
      return
    }

    // Pen tool: drag to create bezier handles
    if (tool === 'pen' && penDraggingRef.current && penLastPointRef.current) {
      const currentPenPathId = penPathRef.current
      if (currentPenPathId !== null) {
        const existing = getProject().activeLayer.children.find(
          (c) => c.id === currentPenPathId
        ) as paper.Path | undefined
        if (existing && existing.segments.length > 0) {
          const lastSeg = existing.lastSegment
          const delta = viewPoint.subtract(penLastPointRef.current)
          lastSeg.handleOut = delta
          lastSeg.handleIn = delta.multiply(-1)

          // Draw handle guide lines
          if (handleGuideRef.current) {
            handleGuideRef.current.remove()
          }
          const guideGroup = new paper.Group()
          guideGroup.data = { isGuide: true }
          const line1 = new paper.Path.Line({
            from: penLastPointRef.current,
            to: penLastPointRef.current.add(delta),
            strokeColor: new paper.Color('#ff6600'),
            strokeWidth: 1,
            dashArray: [4, 4],
          })
          const line2 = new paper.Path.Line({
            from: penLastPointRef.current,
            to: penLastPointRef.current.subtract(delta),
            strokeColor: new paper.Color('#ff6600'),
            strokeWidth: 1,
            dashArray: [4, 4],
          })
          const dot1 = new paper.Path.Circle({
            center: penLastPointRef.current.add(delta),
            radius: 3,
            fillColor: new paper.Color('#ff6600'),
          })
          const dot2 = new paper.Path.Circle({
            center: penLastPointRef.current.subtract(delta),
            radius: 3,
            fillColor: new paper.Color('#ff6600'),
          })
          guideGroup.addChildren([line1, line2, dot1, dot2])
          handleGuideRef.current = guideGroup
        }
      }
      return
    }

    // --- Pen tool close indicator ---
    if (tool === 'pen' && !penDraggingRef.current) {
      const currentPenPathId = penPathRef.current
      if (currentPenPathId !== null) {
        const existing = getProject().activeLayer.children.find(
          (c) => c.id === currentPenPathId
        ) as paper.Path | undefined
        if (existing && existing.segments.length > 2) {
          const firstPt = existing.firstSegment.point
          const dist = viewPoint.getDistance(firstPt)
          if (dist < 15) {
            // Show close indicator circle around first point
            if (!penCloseIndicatorRef.current) {
              const indicator = new paper.Path.Circle({
                center: firstPt,
                radius: 8,
                strokeColor: new paper.Color('#ff4444'),
                strokeWidth: 2,
                fillColor: new paper.Color('rgba(255,68,68,0.15)'),
                dashArray: [],
              })
              indicator.data = { isGuide: true }
              penCloseIndicatorRef.current = indicator
            } else {
              (penCloseIndicatorRef.current as paper.Path).position = firstPt
            }
          } else {
            // Remove close indicator when away from first point
            if (penCloseIndicatorRef.current) {
              penCloseIndicatorRef.current.remove()
              penCloseIndicatorRef.current = null
            }
          }
        }
      } else {
        if (penCloseIndicatorRef.current) {
          penCloseIndicatorRef.current.remove()
          penCloseIndicatorRef.current = null
        }
      }
    }

    // --- Hover cursor feedback in node edit mode ---
    if (editModeRef.current === 'node' && !draggingNodeRef.current && tool === 'select') {
	    const zoom = scope.view.zoom ?? 1
      let cursor: string | null = null
      // Check if hovering over a node/handle in the overlay
      const overlay = nodeOverlayRef.current
      if (overlay) {
	      const hitTol = 10 / zoom
	      const hitOverlay = overlay.hitTest(viewPoint, { fill: true, tolerance: hitTol })
        if (hitOverlay?.item?.data?.nodeType) {
          cursor = 'pointer'
        }
      }
      // Check if hovering over path edge (to add node)
      if (!cursor) {
        const sid = editingShapeIdRef.current
        if (sid) {
          const drawLayer = getDrawLayer()
          const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
          if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
	          const strokeTol = 8 / zoom
	          const strokeHit = item.hitTest(viewPoint, { stroke: true, tolerance: strokeTol })
            if (strokeHit && strokeHit.type === 'stroke') {
              cursor = 'copy' // crosshair-like to indicate "add node here"
            }
          }
        }
      }
      setNodeHoverCursor(cursor)
      return
    }

    // --- Rotation handle drag ---
    if (rotateDragRef.current && tool === 'select') {
      const { center, startAngle, lastAppliedAngle } = rotateDragRef.current
      const currentAngle = Math.atan2(viewPoint.y - center.y, viewPoint.x - center.x)
      let deltaAngle = (currentAngle - startAngle) * (180 / Math.PI)
      // Shift: snap to 15° increments
      if (e.shiftKey) {
        deltaAngle = Math.round(deltaAngle / 15) * 15
      }
      // Compute incremental rotation from last applied angle
      const incrementalAngle = deltaAngle - lastAppliedAngle
      rotateDragRef.current.lastAppliedAngle = deltaAngle
      const drawLayer = getDrawLayer()
      const state = useStore.getState()
      for (const sid of state.selectedShapeIds) {
        const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
        if (!item) continue
        // Rotate incrementally around the shared center
        item.rotate(incrementalAngle, center)
      }
      if (canvasRef.current) {
        canvasRef.current.style.cursor = 'grabbing'
      }
      // Redraw selection overlay to follow rotated shapes
      drawSelectionOverlay()
      return
    }

    // --- Resize handle drag ---
    if (resizeDragRef.current && tool === 'select') {
      const { handle, anchorPoint, startBounds } = resizeDragRef.current
      const drawLayer = getDrawLayer()
      const state = useStore.getState()

      // Compute new bounds from anchor + current mouse position
      let newX = viewPoint.x
      let newY = viewPoint.y
      // For edge handles, constrain the axis that shouldn't change
      if (handle === 't' || handle === 'b') newX = handle === 't' ? startBounds.topRight.x : startBounds.bottomRight.x
      if (handle === 'l' || handle === 'r') newY = handle === 'l' ? startBounds.bottomLeft.y : startBounds.bottomRight.y

      let newBounds = new paper.Rectangle(anchorPoint, new paper.Point(newX, newY))

      // Shift: constrain proportions
      if (e.shiftKey && startBounds.width > 0 && startBounds.height > 0) {
        const aspect = startBounds.width / startBounds.height
        let w = Math.abs(newBounds.width)
        let h = Math.abs(newBounds.height)
        if (w / h > aspect) {
          h = w / aspect
        } else {
          w = h * aspect
        }
        // Preserve the direction of scaling relative to anchor
        const signX = (newX >= anchorPoint.x) ? 1 : -1
        const signY = (newY >= anchorPoint.y) ? 1 : -1
        newBounds = new paper.Rectangle(anchorPoint, new paper.Point(anchorPoint.x + signX * w, anchorPoint.y + signY * h))
      }

      // Compute scale factors
      const scaleX = startBounds.width > 0 ? newBounds.width / startBounds.width : 1
      const scaleY = startBounds.height > 0 ? newBounds.height / startBounds.height : 1

      // Apply scale to all selected shapes relative to anchor point
      for (const sid of state.selectedShapeIds) {
        const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
        if (!item) continue
        // Restore original transform first (we scale from original each frame)
        // We store original data on first frame
        if (!item.data._resizeOrigBounds) {
          item.data._resizeOrigBounds = { x: item.bounds.x, y: item.bounds.y, w: item.bounds.width, h: item.bounds.height }
          item.data._resizeOrigPos = { x: item.position.x, y: item.position.y }
        }
        const orig = item.data._resizeOrigBounds
        const origPos = item.data._resizeOrigPos

        // Compute new position and scale relative to anchor
        const relX = origPos.x - anchorPoint.x
        const relY = origPos.y - anchorPoint.y
        item.position = new paper.Point(anchorPoint.x + relX * scaleX, anchorPoint.y + relY * scaleY)

        // Scale the item's size
        const targetW = orig.w * Math.abs(scaleX)
        const targetH = orig.h * Math.abs(scaleY)
        if (item.bounds.width > 0 && item.bounds.height > 0) {
          item.scale(targetW / item.bounds.width, targetH / item.bounds.height)
        }
      }

      // Update cursor to resize cursor
      if (canvasRef.current) {
        const cursorMap: Record<string, string> = {
          'tl': 'nwse-resize', 'br': 'nwse-resize',
          'tr': 'nesw-resize', 'bl': 'nesw-resize',
          't': 'ns-resize', 'b': 'ns-resize',
          'l': 'ew-resize', 'r': 'ew-resize',
        }
        canvasRef.current.style.cursor = cursorMap[handle] || 'default'
      }
      // Redraw selection overlay to follow resized shapes
      drawSelectionOverlay()
      return
    }

    // --- Hover cursor feedback in select mode ---
    if (!dragStartRef.current) {
      if (tool === 'select') {
        const drawLayer = getDrawLayer()
        // Check if hovering over a resize or rotate handle
        if (selectionOverlayRef.current) {
          const handleHit = selectionOverlayRef.current.hitTest(viewPoint, { fill: true, tolerance: 8 / (scope.view.zoom ?? 1) })
          if (handleHit?.item?.data?.rotateHandle) {
            if (canvasRef.current) canvasRef.current.style.cursor = 'grab'
            return
          }
          if (handleHit?.item?.data?.resizeHandle) {
            const hid = handleHit.item.data.resizeHandle as string
            const cursorMap: Record<string, string> = {
              'tl': 'nwse-resize', 'br': 'nwse-resize',
              'tr': 'nesw-resize', 'bl': 'nesw-resize',
              't': 'ns-resize', 'b': 'ns-resize',
              'l': 'ew-resize', 'r': 'ew-resize',
            }
            if (canvasRef.current) canvasRef.current.style.cursor = cursorMap[hid] || 'default'
            return
          }
        }
        const hitResult = drawLayer.hitTest(viewPoint, { fill: true, stroke: true, tolerance: 8 })
        const hitItem = hitTestShape(drawLayer, hitResult)
        if (canvasRef.current) {
          canvasRef.current.style.cursor = hitItem ? 'move' : 'default'
        }
      }
      return
    }

    if (tool === 'select' && selectedItemRef.current && dragOffsetRef.current) {
      isDraggingShapeRef.current = true
      if (canvasRef.current) canvasRef.current.style.cursor = 'move'
      let newPos = viewPoint.add(dragOffsetRef.current)
      const state = useStore.getState()

      // Alt+drag: clone shapes (once per drag)
      if (e.altKey && !altDragClonedRef.current) {
        altDragClonedRef.current = true
        const drawLayer = getDrawLayer()
        for (const sid of state.selectedShapeIds) {
          const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
          const shapeData = state.shapes.find((s) => s.id === sid)
          if (item && shapeData) {
            const clone = item.clone()
            const cloneId = nextId()
            clone.data = { shapeId: cloneId }
            drawLayer.addChild(clone)
            const cloneShape: ShapeItem = {
              ...shapeData,
              id: cloneId,
              name: shapeData.name + ' copy',
              paperItemId: clone.id,
            }
            state.addShape(cloneShape)
          }
        }
      }

      // Snap-to-grid
      if (state.snapToGrid && state.gridSize > 0) {
        newPos = snapPointToGrid(newPos, state.gridSize)
      }

      const delta = newPos.subtract(selectedItemRef.current.position)
      // Move ALL selected shapes together
      const drawLayer = getDrawLayer()
      for (const sid of state.selectedShapeIds) {
        const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
        if (item) item.position = item.position.add(delta)
      }

      // Smart guides: detect alignment and snap
      const guideSnap = drawSmartGuides(state.selectedShapeIds)
      if (guideSnap.x !== 0 || guideSnap.y !== 0) {
        for (const sid of state.selectedShapeIds) {
          const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
          if (item) item.position = item.position.add(guideSnap)
        }
      }
      // Redraw selection overlay to follow dragged shapes
      drawSelectionOverlay()
      return
    }

    // Preview shape
    if (previewRef.current) {
      previewRef.current.remove()
      previewRef.current = null
    }

    const style = currentStyleRef.current
    const from = dragStartRef.current
    // Shift-constrain to perfect square / circle
    let to = e.shiftKey ? constrainDrag(from, viewPoint) : viewPoint
    // Snap draw endpoint to grid
    const snapState = useStore.getState()
    if (snapState.snapToGrid && snapState.gridSize > 0) {
      to = snapPointToGrid(to, snapState.gridSize)
    }

    switch (tool) {
      case 'rectangle':
        previewRef.current = createRectangle(from, to, { ...style, opacity: 0.5 })
        break
      case 'circle': {
        const radius = from.getDistance(to) / 2
        const center = from.add(to).divide(2)
        previewRef.current = createCircle(center, Math.max(radius, 1), { ...style, opacity: 0.5 })
        break
      }
      case 'roundedRect':
        previewRef.current = createRoundedRect(from, to, 12, { ...style, opacity: 0.5 })
        break
      case 'polygon': {
        const r = from.getDistance(to) / 2
        const c = from.add(to).divide(2)
        previewRef.current = createPolygon(c, 6, Math.max(r, 1), { ...style, opacity: 0.5 })
        break
      }
      case 'star': {
        const r2 = from.getDistance(to) / 2
        const c2 = from.add(to).divide(2)
        previewRef.current = createStar(c2, 5, r2 * 0.4, Math.max(r2, 1), { ...style, opacity: 0.5 })
        break
      }
      case 'line':
        previewRef.current = createLine(from, to, { ...style, opacity: 0.5 })
        break
    }

    // Dimension tooltip
    if (tool === 'line') {
      const len = Math.round(from.getDistance(to))
      setDimTooltip({ x: e.clientX + 14, y: e.clientY + 14, text: `${len} px` })
    } else if (['rectangle', 'circle', 'roundedRect', 'polygon', 'star'].includes(tool)) {
      const w = Math.round(Math.abs(to.x - from.x))
      const h = Math.round(Math.abs(to.y - from.y))
      setDimTooltip({ x: e.clientX + 14, y: e.clientY + 14, text: `${w} × ${h}` })
    }
  }, [toProjectPoint, activateDrawLayer, drawNodeOverlay])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()
    activateDrawLayer()

    // --- Pan end ---
    if (isPanningRef.current) {
      isPanningRef.current = false
      panStartRef.current = null
      panViewCenterRef.current = null
      drawGrid(scope, gridLayerRef.current)
      drawRulers(scope, hRulerRef.current, vRulerRef.current)
      drawSelectionOverlay()
      return
    }

    // --- Marquee selection end ---
    if (marqueeStartRef.current) {
      const viewPoint = toProjectPoint(e)
      if (marqueeRectRef.current) {
        marqueeRectRef.current.remove()
        marqueeRectRef.current = null
      }
      const r = new paper.Rectangle(marqueeStartRef.current, viewPoint)
      if (r.width > 2 || r.height > 2) {
        // Find shapes whose bounds intersect the marquee
        const drawLayer = getDrawLayer()
        const state = useStore.getState()
        const hits: string[] = []
        for (const shape of state.shapes) {
          const item = drawLayer.children.find((c) => c.data?.shapeId === shape.id)
          if (item && r.intersects(item.bounds)) {
            hits.push(shape.id)
          }
        }
        if (e.shiftKey) {
          // Add to existing selection
          const existing = state.selectedShapeIds
          const merged = [...new Set([...existing, ...hits])]
          state.setSelectedShapeIds(merged)
        } else {
          state.setSelectedShapeIds(hits)
        }
      }
      marqueeStartRef.current = null
      return
    }

    // --- Freehand drawing end ---
    if (freehandPathRef.current) {
      const path = freehandPathRef.current
      freehandPathRef.current = null
      if (path.segments.length < 2) {
        path.remove()
        return
      }
      // Simplify freehand path to reduce nodes
      path.simplify(2.5)
      const style = currentStyleRef.current
      applyStyle(path, { ...style, fillColor: null })
      // If stroke was 0, make it visible
      if (style.strokeWidth === 0) {
        path.strokeWidth = 2
        path.strokeColor = new paper.Color(style.strokeColor || '#ffffff')
      }
      path.opacity = style.opacity
      const shapeId = nextId()
      path.data = { shapeId }
      const shapeItem: ShapeItem = {
        id: shapeId,
        name: `Freehand ${shapeId.split('_')[1]}`,
        paperItemId: path.id,
        style: { ...style, fillColor: null, strokeWidth: style.strokeWidth > 0 ? style.strokeWidth : 2 },
        visible: true,
        locked: false,
      }
      useStore.getState().addShape(shapeItem)
      useStore.getState().setSelectedShapeIds([shapeId])
      saveHistory('Draw freehand')
      // Auto-switch to Select
      useStore.getState().setActiveTool('select')
      return
    }

    // Node edit mode: finish dragging
    if (draggingNodeRef.current) {
      draggingNodeRef.current = null
      dragStartRef.current = null
      saveHistory('Edit node')
      return
    }

    // --- Rotation handle drag end ---
    if (rotateDragRef.current) {
      rotateDragRef.current = null
      saveHistory('Rotate')
      return
    }

    // --- Resize handle drag end ---
    if (resizeDragRef.current) {
      // Clean up stored original bounds from items
      const drawLayer = getDrawLayer()
      const state = useStore.getState()
      for (const sid of state.selectedShapeIds) {
        const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
        if (item) {
          delete item.data._resizeOrigBounds
          delete item.data._resizeOrigPos
        }
      }
      resizeDragRef.current = null
      saveHistory('Resize')
      return
    }

    // Pen tool: finish handle drag
    if (activeToolRef.current === 'pen') {
      penDraggingRef.current = false
      penLastPointRef.current = null
      if (handleGuideRef.current) {
        handleGuideRef.current.remove()
        handleGuideRef.current = null
      }
      return
    }

    if (activeToolRef.current === 'select') {
      // Push history if we actually moved a shape
      if (isDraggingShapeRef.current) {
        isDraggingShapeRef.current = false
        clearSmartGuides()
        saveHistory(altDragClonedRef.current ? 'Alt+drag duplicate' : 'Move')
      }
      altDragClonedRef.current = false
      dragOffsetRef.current = null
      selectedItemRef.current = null
      return
    }

    if (!dragStartRef.current) return
    const viewPoint = toProjectPoint(e)
    // Shift-constrain to perfect square / circle
    let finalTo = e.shiftKey ? constrainDrag(dragStartRef.current, viewPoint) : viewPoint
    // Snap draw endpoint to grid
    const snapSt = useStore.getState()
    if (snapSt.snapToGrid && snapSt.gridSize > 0) {
      finalTo = snapPointToGrid(finalTo, snapSt.gridSize)
    }

    // Remove preview
    if (previewRef.current) {
      previewRef.current.remove()
      previewRef.current = null
    }
    setDimTooltip(null)

    // Finalize shape
    finalizeShape(dragStartRef.current, finalTo)
    dragStartRef.current = null
  }, [toProjectPoint, activateDrawLayer, saveHistory])

  const finalizeShape = useCallback((from: paper.Point, to: paper.Point) => {
    const style = currentStyleRef.current
    const tool = activeToolRef.current
    let item: paper.Item | null = null
    let primitiveType: import('../types').PrimitiveType | undefined
    let primitiveParams: import('../types').PrimitiveParams | undefined

    switch (tool) {
      case 'rectangle':
        item = createRectangle(from, to, style)
        primitiveType = 'rectangle'
        break
      case 'circle': {
        const radius = from.getDistance(to) / 2
        const center = from.add(to).divide(2)
        item = createCircle(center, Math.max(radius, 5), style)
        primitiveType = 'circle'
        break
      }
      case 'roundedRect':
        item = createRoundedRect(from, to, 12, style)
        primitiveType = 'roundedRect'
        primitiveParams = { cornerRadius: 12 }
        break
      case 'polygon': {
        const r = from.getDistance(to) / 2
        const c = from.add(to).divide(2)
        item = createPolygon(c, 6, Math.max(r, 5), style)
        primitiveType = 'polygon'
        primitiveParams = { sides: 6 }
        break
      }
      case 'star': {
        const r2 = from.getDistance(to) / 2
        const c2 = from.add(to).divide(2)
        item = createStar(c2, 5, r2 * 0.4, Math.max(r2, 5), style)
        primitiveType = 'star'
        primitiveParams = { points: 5, innerRadius: r2 * 0.4, outerRadius: Math.max(r2, 5) }
        break
      }
      case 'line':
        item = createLine(from, to, style)
        primitiveType = 'pen' // Lines are path-based like pen paths
        break
    }

    if (item) {
      const id = nextId()
      item.data = { shapeId: id }
      const shapeItem: ShapeItem = {
        id,
        name: `${tool} ${useStore.getState().shapes.length + 1}`,
        paperItemId: item.id,
        style: { ...style },
        visible: true,
        locked: false,
        primitiveType,
        primitiveParams,
      }
      addShape(shapeItem)
      // Auto-select the new shape and switch to Select tool
      useStore.getState().setSelectedShapeIds([id])
      useStore.getState().setActiveTool('select')
      saveHistory(`Create ${tool}`)
    }
  }, [addShape, saveHistory])

  const handleSelectDown = useCallback((point: paper.Point, shiftKey: boolean) => {
    const drawLayer = getDrawLayer()

    // Hit test only on the draw layer, skip grid/guides
    const hitResult = drawLayer.hitTest(point, {
      fill: true, stroke: true, segments: true, tolerance: 8,
    })

    // Walk up to find the item with a shapeId (skip guide items)
    const hitItem = hitTestShape(drawLayer, hitResult)

    if (hitItem && hitItem.data?.shapeId) {
      const shapeId = hitItem.data.shapeId
      // Check if shape is locked — don't allow drag if locked
      const shapeData = useStore.getState().shapes.find((s) => s.id === shapeId)
      const isLocked = shapeData?.locked ?? false

      if (!isLocked) {
        selectedItemRef.current = hitItem
        dragStartRef.current = point
        dragOffsetRef.current = hitItem.position.subtract(point)
        isDraggingShapeRef.current = false // will be set to true on first move
      } else {
        selectedItemRef.current = null
      }

      const current = useStore.getState().selectedShapeIds
      if (shiftKey) {
        if (current.includes(shapeId)) {
          setSelectedShapeIds(current.filter((id) => id !== shapeId))
        } else {
          setSelectedShapeIds([...current, shapeId])
        }
      } else {
        if (!current.includes(shapeId)) {
          setSelectedShapeIds([shapeId])
        }
      }
    } else {
      selectedItemRef.current = null
      if (!shiftKey) setSelectedShapeIds([])
      // Start marquee selection
      marqueeStartRef.current = point
    }
  }, [setSelectedShapeIds])

  const handlePenDown = useCallback((point: paper.Point) => {
    const scope = scopeRef.current!
    scope.activate()
    const style = currentStyleRef.current
    const currentPenPathId = penPathRef.current

    if (currentPenPathId !== null) {
      // Find existing path
      const existing = getProject().activeLayer.children.find(
        (c) => c.id === currentPenPathId
      ) as paper.Path | undefined

      if (existing) {
        // Check if clicking near first point to close
        const firstSeg = existing.firstSegment
        if (existing.segments.length > 2 && point.getDistance(firstSeg.point) < 15) {
          existing.closePath()
          applyStyle(existing, style)
          const id = nextId()
          existing.data = { shapeId: id }
          const shapeItem: ShapeItem = {
            id,
            name: `pen path ${useStore.getState().shapes.length + 1}`,
            paperItemId: existing.id,
            style: { ...style },
            visible: true,
            locked: false,
          }
          addShape(shapeItem)
          setPenPath(null)
          saveHistory('Close pen path')
          // Clean up guides
          if (handleGuideRef.current) {
            handleGuideRef.current.remove()
            handleGuideRef.current = null
          }
          if (penCloseIndicatorRef.current) {
            penCloseIndicatorRef.current.remove()
            penCloseIndicatorRef.current = null
          }
          return
        }
        // Add new point — drag will create bezier handles
        existing.add(new paper.Segment(point))
        penDraggingRef.current = true
        penLastPointRef.current = point
        return
      }
    }

    // Start new pen path
    const path = new paper.Path({
      strokeColor: new paper.Color(style.strokeColor || '#ffffff'),
      strokeWidth: 2,
      fillColor: null as any,
    })
    path.add(new paper.Segment(point))
    setPenPath(path.id)
    penDraggingRef.current = true
    penLastPointRef.current = point
  }, [addShape, setPenPath, saveHistory])

  // Double-click: finish pen path OR enter node edit mode
  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    // Pen tool: finish open path
    const currentPenPathId = penPathRef.current
    if (currentPenPathId !== null) {
      const existing = getProject().activeLayer.children.find(
        (c) => c.id === currentPenPathId
      ) as paper.Path | undefined
      if (existing && existing.segments.length > 1) {
        const style = currentStyleRef.current
        existing.closePath()
        applyStyle(existing, style)
        const id = nextId()
        existing.data = { shapeId: id }
        const shapeItem: ShapeItem = {
          id,
          name: `pen path ${useStore.getState().shapes.length + 1}`,
          paperItemId: existing.id,
          style: { ...style },
          visible: true,
          locked: false,
        }
        addShape(shapeItem)
        setPenPath(null)
        saveHistory('Finish pen path')
        if (handleGuideRef.current) {
          handleGuideRef.current.remove()
          handleGuideRef.current = null
        }
        if (penCloseIndicatorRef.current) {
          penCloseIndicatorRef.current.remove()
          penCloseIndicatorRef.current = null
        }
      }
      return
    }

    // Select tool: double-click on a shape to enter node edit mode
    if (activeToolRef.current === 'select') {
      const scope = scopeRef.current
      if (!scope) return
      scope.activate()
      const point = toProjectPoint(e)
      const drawLayer = getDrawLayer()
      const hitResult = drawLayer.hitTest(point, {
        fill: true, stroke: true, segments: true, tolerance: 8,
      })
      const hitItem = hitTestShape(drawLayer, hitResult)
      if (hitItem && hitItem.data?.shapeId) {
        enterNodeEdit(hitItem.data.shapeId)
      }
    }
  }, [addShape, setPenPath, saveHistory, toProjectPoint, enterNodeEdit])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const store = useStore.getState()

      // ? key — toggle shortcuts help overlay
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        const st = useStore.getState()
        st.setShowShortcutsHelp(!st.showShortcutsHelp)
        return
      }

      // Space held for pan mode
      if (e.key === ' ' && !e.repeat) {
        e.preventDefault()
        useStore.getState().setSpaceHeld(true)
        return
      }

      // --- Undo: Ctrl+Z ---
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        const entry = store.undo()
        if (entry) restoreHistory(entry)
        return
      }
      // --- Redo: Ctrl+Shift+Z OR Ctrl+Y ---
      if ((e.ctrlKey && e.shiftKey && e.key === 'Z') || (e.ctrlKey && e.key === 'y')) {
        e.preventDefault()
        const entry = store.redo()
        if (entry) restoreHistory(entry)
        return
      }

      // --- Select All: Ctrl+A ---
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault()
        store.setSelectedShapeIds(store.shapes.map((s) => s.id))
        return
      }

      // --- Duplicate: Ctrl+D ---
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault()
        handleDuplicate()
        return
      }

      // --- Copy: Ctrl+C ---
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault()
        handleCopy()
        return
      }

      // --- Cut: Ctrl+X ---
      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault()
        handleCopy()
        deleteSelected()
        return
      }

      // --- Paste: Ctrl+V ---
      // Don't preventDefault here — let the browser fire the paste event
      // so we can detect SVG markup in the system clipboard.
      // The paste event handler (onPaste) handles both SVG import and internal clipboard.
      if (e.ctrlKey && e.key === 'v') {
        return
      }

      // --- Layer order: Ctrl+] / Ctrl+[ ---
      if (e.ctrlKey && e.key === ']') {
        e.preventDefault()
        for (const sid of store.selectedShapeIds) {
          if (e.shiftKey) { store.bringToFront(sid) } else { store.bringForward(sid) }
        }
        reorderPaperItems()
        saveHistory('Reorder layers')
        return
      }
      if (e.ctrlKey && e.key === '[') {
        e.preventDefault()
        for (const sid of [...store.selectedShapeIds].reverse()) {
          if (e.shiftKey) { store.sendToBack(sid) } else { store.sendBackward(sid) }
        }
        reorderPaperItems()
        saveHistory('Reorder layers')
        return
      }

      // --- Group: Ctrl+G ---
      if (e.ctrlKey && !e.shiftKey && e.key === 'g') {
        e.preventDefault()
        if (store.selectedShapeIds.length >= 2) {
          const drawLayer = getDrawLayer()
          const items: paper.Item[] = []
          for (const sid of store.selectedShapeIds) {
            const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
            if (item) items.push(item)
          }
          if (items.length >= 2) {
            const group = new paper.Group(items)
            const groupId = nextId()
            group.data = { shapeId: groupId }
            // Remove old shape entries from store
            for (const sid of store.selectedShapeIds) {
              store.removeShape(sid)
            }
            // Add group as a single shape
            const groupShape: ShapeItem = {
              id: groupId,
              name: `group ${store.shapes.length + 1}`,
              paperItemId: group.id,
              style: { ...store.currentStyle },
              visible: true,
              locked: false,
              isGroup: true,
            }
            store.addShape(groupShape)
            store.setSelectedShapeIds([groupId])
            saveHistory('Group')
          }
        }
        return
      }

      // --- Ungroup: Ctrl+Shift+G ---
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault()
        const drawLayer = getDrawLayer()
        const newIds: string[] = []
        for (const sid of store.selectedShapeIds) {
          const shapeData = store.shapes.find((s) => s.id === sid)
          if (!shapeData?.isGroup) continue
          const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
          if (!item || !(item instanceof paper.Group)) continue
          // Move children out of the group back to draw layer
          const children = [...item.children]
          for (const child of children) {
            drawLayer.addChild(child)
            const childId = nextId()
            child.data = { shapeId: childId }
            const childShape: ShapeItem = {
              id: childId,
              name: `shape ${store.shapes.length + newIds.length + 1}`,
              paperItemId: child.id,
              style: { ...shapeData.style },
              visible: true,
              locked: false,
            }
            store.addShape(childShape)
            newIds.push(childId)
          }
          item.remove()
          store.removeShape(sid)
        }
        if (newIds.length > 0) {
          store.setSelectedShapeIds(newIds)
          saveHistory('Ungroup')
        }
        return
      }

      // --- Tool shortcuts (only when no modifier held) ---
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === 'v' || e.key === 'V') { setActiveTool('select'); return }
        if (e.key === 'r' || e.key === 'R') { setActiveTool('rectangle'); return }
        if (e.key === 'o' || e.key === 'O') { setActiveTool('circle'); return }
        if (e.key === 'p' || e.key === 'P') { setActiveTool('pen'); return }
        if (e.key === 'l' || e.key === 'L') { setActiveTool('line'); return }
        if (e.key === 'u' || e.key === 'U') { setActiveTool('roundedRect'); return }
        if (e.key === 'y' || e.key === 'Y') { setActiveTool('polygon'); return }
        if (e.key === 'n' || e.key === 'N') { setActiveTool('freehand'); return }
        if (e.key === 't' || e.key === 'T') { setActiveTool('text'); return }
        if (e.key === 'm' || e.key === 'M') { setActiveTool('measure'); return }
        if (e.key === 'i' || e.key === 'I') { setActiveTool('eyedropper'); return }

        // --- Arrow key nudge ---
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          let dx = 0, dy = 0
          if (e.key === 'ArrowLeft') dx = -step
          if (e.key === 'ArrowRight') dx = step
          if (e.key === 'ArrowUp') dy = -step
          if (e.key === 'ArrowDown') dy = step
          nudgeSelected(dx, dy)
          return
        }

        // --- Focus / zoom-to-fit: F ---
        if (e.key === 'f' || e.key === 'F') {
          zoomToFit()
          return
        }

        // --- Home: reset view to origin at 100% zoom ---
        if (e.key === 'Home') {
          e.preventDefault()
          const scope = scopeRef.current
          if (scope) {
            scope.view.center = new paper.Point(0, 0)
            scope.view.zoom = 1
            drawGrid(scope, gridLayerRef.current)
            drawRulers(scope, hRulerRef.current, vRulerRef.current)
            drawSelectionOverlay()
            useStore.getState().setZoomLevel(1)
          }
          return
        }

        // --- Delete / Backspace ---
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // In node edit mode: delete selected node
          if (editModeRef.current === 'node' && selectedNodeRef.current !== null) {
            e.preventDefault()
            const sid = editingShapeIdRef.current
            if (sid) {
              const drawLayer = scopeRef.current?.project.activeLayer
              if (drawLayer) {
                const item = drawLayer.children.find((c: paper.Item) => c.data?.shapeId === sid)
                if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
                  const paths: paper.Path[] = item instanceof paper.CompoundPath
                    ? (item.children as paper.Path[]) : [item as paper.Path]
                  let count = 0
                  let targetSeg: paper.Segment | null = null
                  for (const p of paths) {
                    if (selectedNodeRef.current < count + p.segments.length) {
                      // Don't delete if path would have fewer than 2 segments
                      if (p.segments.length <= 2) break
                      targetSeg = p.segments[selectedNodeRef.current - count]
                      break
                    }
                    count += p.segments.length
                  }
                  if (targetSeg) {
                    targetSeg.remove()
                    selectedNodeRef.current = null
                    drawNodeOverlay()
                    saveHistory('Delete node')
                  }
                }
              }
            }
            return
          }
          deleteSelected()
          return
        }

        // --- Smooth/corner toggle for selected node: S key ---
        if (editModeRef.current === 'node' && selectedNodeRef.current !== null) {
          if (e.key === 's' || e.key === 'S') {
            e.preventDefault()
            const sid = editingShapeIdRef.current
            if (sid) {
              const drawLayer = scopeRef.current?.project.activeLayer
              if (drawLayer) {
                const item = drawLayer.children.find((c: paper.Item) => c.data?.shapeId === sid)
                if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
                  const paths: paper.Path[] = item instanceof paper.CompoundPath
                    ? (item.children as paper.Path[]) : [item as paper.Path]
                  let count = 0
                  let targetSeg: paper.Segment | null = null
                  for (const p of paths) {
                    if (selectedNodeRef.current! < count + p.segments.length) {
                      targetSeg = p.segments[selectedNodeRef.current! - count]
                      break
                    }
                    count += p.segments.length
                  }
                  if (targetSeg) {
                    const isSmooth = targetSeg.handleIn.length > 0 || targetSeg.handleOut.length > 0
                    if (isSmooth) {
                      // Make corner: remove handles
                      targetSeg.handleIn = new paper.Point(0, 0)
                      targetSeg.handleOut = new paper.Point(0, 0)
                    } else {
                      // Make smooth: auto-generate handles based on neighbor segments
                      targetSeg.smooth()
                    }
                    drawNodeOverlay()
                    saveHistory('Toggle smooth/corner')
                  }
                }
              }
            }
            return
          }
        }

        // --- Zoom shortcuts ---
        // Ctrl+0: fit all content to canvas
        if (e.ctrlKey && e.key === '0') {
          e.preventDefault()
          const scope = scopeRef.current
          if (scope) {
            const drawLayer = getDrawLayer()
            const bounds = drawLayer.bounds
            if (bounds.width > 0 && bounds.height > 0) {
              const vw = scope.view.viewSize.width
              const vh = scope.view.viewSize.height
              const fitZoom = Math.min(vw / bounds.width, vh / bounds.height) * 0.85
              scope.view.zoom = Math.min(Math.max(fitZoom, 0.05), 50)
              scope.view.center = bounds.center
            } else {
              scope.view.zoom = 1
              scope.view.center = new paper.Point(scope.view.viewSize.width / 2, scope.view.viewSize.height / 2)
            }
            drawGrid(scope, gridLayerRef.current)
            drawRulers(scope, hRulerRef.current, vRulerRef.current)
            drawSelectionOverlay()
            useStore.getState().setZoomLevel(scope.view.zoom)
          }
          return
        }
        // Ctrl+1: zoom to 100%
        if (e.ctrlKey && e.key === '1') {
          e.preventDefault()
          const scope = scopeRef.current
          if (scope) {
            scope.view.zoom = 1
            drawGrid(scope, gridLayerRef.current)
            drawRulers(scope, hRulerRef.current, vRulerRef.current)
            drawSelectionOverlay()
            useStore.getState().setZoomLevel(1)
          }
          return
        }
        // Ctrl+= / Ctrl+-: zoom in/out
        if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
          e.preventDefault()
          const scope = scopeRef.current
          if (scope) {
            const newZoom = Math.min(scope.view.zoom * 1.25, 50)
            scope.view.zoom = newZoom
            drawGrid(scope, gridLayerRef.current)
            drawRulers(scope, hRulerRef.current, vRulerRef.current)
            drawSelectionOverlay()
            useStore.getState().setZoomLevel(newZoom)
          }
          return
        }
        if (e.ctrlKey && e.key === '-') {
          e.preventDefault()
          const scope = scopeRef.current
          if (scope) {
            const newZoom = Math.max(scope.view.zoom / 1.25, 0.05)
            scope.view.zoom = newZoom
            drawGrid(scope, gridLayerRef.current)
            drawRulers(scope, hRulerRef.current, vRulerRef.current)
            drawSelectionOverlay()
            useStore.getState().setZoomLevel(newZoom)
          }
          return
        }

        // --- Escape ---
        if (e.key === 'Escape') {
          // Close shortcuts help if open
          if (useStore.getState().showShortcutsHelp) {
            useStore.getState().setShowShortcutsHelp(false)
            return
          }
          if (editModeRef.current === 'node') {
            selectedNodeRef.current = null
            useStore.getState().exitNodeEdit()
            return
          }
          if (penPathRef.current !== null) {
            const existing = getProject().activeLayer.children.find(
              (c) => c.id === penPathRef.current
            )
            if (existing) existing.remove()
            setPenPath(null)
            if (penCloseIndicatorRef.current) {
              penCloseIndicatorRef.current.remove()
              penCloseIndicatorRef.current = null
            }
            return
          }
          // Deselect all
          store.setSelectedShapeIds([])
          return
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        useStore.getState().setSpaceHeld(false)
      }
    }

    // SVG import via paste event, falls back to internal clipboard
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.trim().startsWith('<svg') || text.trim().startsWith('<?xml')) {
        e.preventDefault()
        try {
          const scope = scopeRef.current
          if (!scope) return
          scope.activate()
          activateDrawLayer()
          const drawLayer = getDrawLayer()
          const imported = scope.project.importSVG(text, { insert: false }) as paper.Item
          if (imported) {
            drawLayer.addChild(imported)
            // Flatten SVG group and assign shape IDs
            const items = imported instanceof paper.Group ? [...imported.children] : [imported]
            const newIds: string[] = []
            for (const child of items) {
              const newId = nextId()
              child.data = { shapeId: newId }
              drawLayer.addChild(child)
              const shapeItem: ShapeItem = {
                id: newId,
                name: 'SVG import',
                paperItemId: child.id,
                style: {
                  fillColor: child.fillColor ? (child.fillColor as paper.Color).toCSS(true) : null,
                  strokeColor: child.strokeColor ? (child.strokeColor as paper.Color).toCSS(true) : '#ffffff',
                  strokeWidth: child.strokeWidth ?? 0,
                  opacity: child.opacity ?? 1,
                  dashArray: child.dashArray && child.dashArray.length > 0 ? [...child.dashArray] : null,
                  strokeCap: (child.strokeCap as 'butt' | 'round' | 'square') || undefined,
                  strokeJoin: (child.strokeJoin as 'miter' | 'round' | 'bevel') || undefined,
                },
                visible: true,
                locked: false,
              }
              useStore.getState().addShape(shapeItem)
              newIds.push(newId)
            }
            if (imported instanceof paper.Group) imported.remove()
            // Center on viewport
            if (newIds.length > 0) {
              const viewCenter = scope.view.center
              let combinedBounds: paper.Rectangle | null = null
              for (const id of newIds) {
                const item = drawLayer.children.find((c) => c.data?.shapeId === id)
                if (item) combinedBounds = combinedBounds ? combinedBounds.unite(item.bounds) : item.bounds.clone()
              }
              if (combinedBounds) {
                const offset = viewCenter.subtract(combinedBounds.center)
                for (const id of newIds) {
                  const item = drawLayer.children.find((c) => c.data?.shapeId === id)
                  if (item) item.position = item.position.add(offset)
                }
              }
            }
            useStore.getState().setSelectedShapeIds(newIds)
            saveHistory('Import SVG')
          }
        } catch (err) {
          console.warn('SVG import failed:', err)
        }
      } else {
        // No SVG detected — use internal clipboard
        e.preventDefault()
        handlePasteRef.current()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('paste', onPaste)
    }
  }, [setActiveTool, setPenPath, saveHistory])

  // --- Nudge selected shapes by dx, dy ---
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    const state = useStore.getState()
    if (state.selectedShapeIds.length === 0) return
    const drawLayer = getDrawLayer()
    for (const sid of state.selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (item) item.position = item.position.add(new paper.Point(dx, dy))
    }
    drawSelectionOverlay()
    saveHistory('Nudge')
  }, [saveHistory, drawSelectionOverlay])

  // --- Zoom to fit selection or all ---
  const zoomToFit = useCallback(() => {
    const state = useStore.getState()
    const drawLayer = getDrawLayer()
    const ids = state.selectedShapeIds.length > 0
      ? state.selectedShapeIds
      : state.shapes.map(s => s.id)
    if (ids.length === 0) return

    let combined: paper.Rectangle | null = null
    for (const sid of ids) {
      const item = drawLayer.children.find(c => c.data?.shapeId === sid)
      if (item) {
        combined = combined ? combined.unite(item.bounds) : item.bounds.clone()
      }
    }
    if (!combined) return

    const view = getScope().view
    view.center = combined.center
    const pad = 1.3
    const zoomX = view.viewSize.width / (combined.width * pad)
    const zoomY = view.viewSize.height / (combined.height * pad)
    view.zoom = Math.min(zoomX, zoomY, 5)
    const scope = getScope()
    drawGrid(scope, gridLayerRef.current)
    drawRulers(scope, hRulerRef.current, vRulerRef.current)
    drawSelectionOverlay()
    useStore.getState().setZoomLevel(view.zoom)
  }, [drawSelectionOverlay])

  // --- Duplicate selected shapes ---
  const handleDuplicate = useCallback(() => {
    const state = useStore.getState()
    if (state.selectedShapeIds.length === 0) return
    const drawLayer = getDrawLayer()
    const newIds: string[] = []
    for (const sid of state.selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      const shapeData = state.shapes.find((s) => s.id === sid)
      if (!item || !shapeData) continue
      const clone = item.clone()
      clone.position = clone.position.add(new paper.Point(20, 20))
      const newId = nextId()
      clone.data = { shapeId: newId }
      const newShape: ShapeItem = {
        id: newId,
        name: shapeData.name + ' copy',
        paperItemId: clone.id,
        style: { ...shapeData.style },
        visible: true,
        locked: false,
        primitiveType: shapeData.primitiveType,
        primitiveParams: shapeData.primitiveParams ? { ...shapeData.primitiveParams } : undefined,
      }
      state.addShape(newShape)
      newIds.push(newId)
    }
    state.setSelectedShapeIds(newIds)
    saveHistory('Duplicate')
  }, [saveHistory])

  // --- Copy selected shapes to clipboard ---
  const handleCopy = useCallback(() => {
    const state = useStore.getState()
    if (state.selectedShapeIds.length === 0) return
    const drawLayer = getDrawLayer()
    const items: paper.Item[] = []
    const shapeDatas: ShapeItem[] = []
    for (const sid of state.selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      const shapeData = state.shapes.find((s) => s.id === sid)
      if (item && shapeData) {
        items.push(item)
        shapeDatas.push(shapeData)
      }
    }
    if (items.length === 0) return
    // Serialize by creating a temporary group
    const tempGroup = new paper.Group(items.map(i => i.clone({ insert: false })))
    const json = tempGroup.exportJSON()
    tempGroup.remove()
    state.setClipboard({ shapes: shapeDatas.map(s => ({ ...s })), paperJson: json })
  }, [])

  // --- Paste from clipboard ---
  const handlePaste = useCallback(() => {
    const state = useStore.getState()
    if (!state.clipboard) return
    const drawLayer = getDrawLayer()
    drawLayer.activate()
    state.incrementPasteCount()
    const offset = state.pasteCount * 20 + 20
    // Import the saved group
    const imported = drawLayer.importJSON(state.clipboard.paperJson) as paper.Group
    const newIds: string[] = []
    // Each child of the group becomes a new shape
    const children = [...imported.children]
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      child.position = child.position.add(new paper.Point(offset, offset))
      const newId = nextId()
      child.data = { shapeId: newId }
      // Reparent from temp group into draw layer
      drawLayer.addChild(child)
      const src = state.clipboard.shapes[i]
      if (src) {
        const newShape: ShapeItem = {
          id: newId,
          name: src.name + ' copy',
          paperItemId: child.id,
          style: { ...src.style },
          visible: true,
          locked: false,
          primitiveType: src.primitiveType,
          primitiveParams: src.primitiveParams ? { ...src.primitiveParams } : undefined,
        }
        useStore.getState().addShape(newShape)
      }
      newIds.push(newId)
    }
    imported.remove() // remove the now-empty group shell
    useStore.getState().setSelectedShapeIds(newIds)
    saveHistory('Paste')
  }, [saveHistory])
  handlePasteRef.current = handlePaste

  // --- Reorder Paper.js items to match store order ---
  const reorderPaperItems = useCallback(() => {
    const state = useStore.getState()
    const drawLayer = getDrawLayer()
    for (const shape of state.shapes) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === shape.id)
      if (item) drawLayer.addChild(item) // re-appending moves it to the end
    }
  }, [])

  const deleteSelected = useCallback(() => {
    const state = useStore.getState()
    const drawLayer = getDrawLayer()
    for (const sid of state.selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (item) item.remove()
      state.removeShape(sid)
    }
    state.setSelectedShapeIds([])
    saveHistory('Delete')
  }, [saveHistory])

  const restoreHistory = useCallback((entry: HistoryEntry) => {
    const scope = scopeRef.current!
    scope.activate()
    const project = getProject()
    // Clear only the draw layer, keep grid
    const drawLayer = getDrawLayer()
    drawLayer.removeChildren()
    drawLayer.activate()
    // Import restores items into the active layer
    project.importJSON(entry.json)
    useStore.getState().setShapes([...entry.shapes])
  }, [])

  // Register the restoreHistory callback so App.tsx undo/redo buttons work
  useEffect(() => {
    useStore.getState().setRestoreCallback(restoreHistory)
    return () => useStore.getState().setRestoreCallback(null)
  }, [restoreHistory])

  // Draw selection highlights around selected shapes (callable imperatively)
  // Trigger node overlay redraw when edit mode changes
  useEffect(() => {
    drawNodeOverlay()
	}, [editMode, editingShapeId, shapes, zoomLevel, drawNodeOverlay])

  // --- Mouse wheel zoom ---
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()

    const rect = canvasRef.current!.getBoundingClientRect()
    const viewPt = new paper.Point(e.clientX - rect.left, e.clientY - rect.top)
    const projPt = scope.view.viewToProject(viewPt)

    // Zoom factor: scroll up = zoom in, scroll down = zoom out
    const delta = -e.deltaY
    const factor = delta > 0 ? 1.08 : 1 / 1.08
    const newZoom = Math.min(Math.max(scope.view.zoom * factor, 0.05), 50)

    // Zoom toward mouse position
    const oldZoom = scope.view.zoom
    scope.view.zoom = newZoom
    // Adjust center so the point under cursor stays fixed
    const scaleFactor = oldZoom / newZoom
    const viewCenter = scope.view.center
    const offset = projPt.subtract(viewCenter)
    scope.view.center = projPt.subtract(offset.multiply(scaleFactor))

    drawGrid(scope, gridLayerRef.current)
    drawRulers(scope, hRulerRef.current, vRulerRef.current)
    drawSelectionOverlay()
    useStore.getState().setZoomLevel(newZoom)
  }, [drawSelectionOverlay])

  /**
   * Bevel (chamfer) the currently selected node in node-edit mode by inserting
   * two new points offset from the corner along the adjacent edges.
   *
   * Note: for now this is intentionally conservative and only supports
   * straight/corner nodes (no bezier handles) on paths with well-defined
   * prev/next segments.
   */
  const bevelSelectedNode = useCallback((distance: number) => {
    const sid = editingShapeIdRef.current
    const globalIdx = selectedNodeRef.current
    if (!sid || globalIdx === null) return
    if (!Number.isFinite(distance) || distance <= 0) return

    const drawLayer = getDrawLayer()
    const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
    if (!item || !(item instanceof paper.Path || item instanceof paper.CompoundPath)) return

    const paths: paper.Path[] = item instanceof paper.CompoundPath
      ? (item.children as paper.Path[])
      : [item as paper.Path]

    // Locate the segment across all sub-paths
    let count = 0
    let path: paper.Path | null = null
    let segIndex = -1
    for (const p of paths) {
      if (globalIdx < count + p.segments.length) {
        path = p
        segIndex = globalIdx - count
        break
      }
      count += p.segments.length
    }
    if (!path || segIndex < 0) return

    const seg = path.segments[segIndex]
    if (!seg) return

    // Only bevel corner points (no bezier handles)
    const isSmooth = seg.handleIn.length > 0 || seg.handleOut.length > 0
    if (isSmooth) {
      window.alert('Bevel currently supports corner points only. Press S to toggle to a corner (remove handles) and try again.')
      return
    }

    const n = path.segments.length
    const isClosed = !!path.closed
    if (!isClosed && (segIndex === 0 || segIndex === n - 1)) {
      window.alert('Cannot bevel the end point of an open path.')
      return
    }
    if (n < 3) return

    const prevSeg = path.segments[(segIndex - 1 + n) % n]
    const nextSeg = path.segments[(segIndex + 1) % n]
    if (!prevSeg || !nextSeg) return

    const corner = seg.point
    const vPrev = prevSeg.point.subtract(corner)
    const vNext = nextSeg.point.subtract(corner)
    const lenPrev = vPrev.length
    const lenNext = vNext.length
    if (lenPrev < 0.001 || lenNext < 0.001) return

    // Clamp distance to avoid crossing past neighbors
    const d = Math.min(distance, lenPrev * 0.49, lenNext * 0.49)
    if (d <= 0) return

    const p1 = corner.add(vPrev.normalize(d))
    const p2 = corner.add(vNext.normalize(d))

    // Replace corner with p1 and insert p2 after it
    seg.point = p1
    seg.handleIn = new paper.Point(0, 0)
    seg.handleOut = new paper.Point(0, 0)
    const newSeg = new paper.Segment(p2)
    newSeg.handleIn = new paper.Point(0, 0)
    newSeg.handleOut = new paper.Point(0, 0)
    path.insert(segIndex + 1, newSeg)

    drawNodeOverlay()
    saveHistory('Bevel corner')
  }, [drawNodeOverlay, saveHistory])

  const bevelSelectedNodePrompt = useCallback(() => {
    const defaultValue = '12'
    const raw = window.prompt('Bevel size (px):', defaultValue)
    if (raw === null) return
    const d = Number.parseFloat(raw)
    if (!Number.isFinite(d) || d <= 0) {
      window.alert('Please enter a positive number.')
      return
    }
    bevelSelectedNode(d)
  }, [bevelSelectedNode])

  // Right-click context menu
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    // Also select vertex under cursor in node edit mode
    const scope = scopeRef.current
    if (scope) {
      scope.activate()
      const rect = canvasRef.current!.getBoundingClientRect()
      const viewPt = scope.view.viewToProject(new paper.Point(e.clientX - rect.left, e.clientY - rect.top))

      if (editModeRef.current === 'node') {
        const overlay = nodeOverlayRef.current
        if (overlay) {
	        const zoom = scope.view.zoom ?? 1
	        const hitTol = 10 / zoom
	        const hitResult = overlay.hitTest(viewPt, { fill: true, tolerance: hitTol })
          if (hitResult?.item?.data?.nodeType) {
            const { nodeType, segIndex } = hitResult.item.data
            if (nodeType === 'point') {
              selectedNodeRef.current = segIndex
              drawNodeOverlay()
            }
          }
        }
      }

      // Also select shape under cursor if nothing selected
      const drawLayer = getDrawLayer()
      const hitResult = drawLayer.hitTest(viewPt, { fill: true, stroke: true, tolerance: 8 })
      const hitItem = hitTestShape(drawLayer, hitResult)
      if (hitItem && hitItem.data?.shapeId) {
        const state = useStore.getState()
        if (!state.selectedShapeIds.includes(hitItem.data.shapeId)) {
          state.setSelectedShapeIds([hitItem.data.shapeId])
        }
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [drawNodeOverlay])

  // Determine cursor
  const getCursorStyle = (): string => {
    if (spaceHeld || isPanningRef.current) return isPanningRef.current ? 'grabbing' : 'grab'
    if (editMode === 'node') return nodeHoverCursor ?? 'default'
    switch (activeTool) {
      case 'select': return 'default'
      case 'pen': return 'crosshair'
      case 'eyedropper': return 'copy'
      default: return 'crosshair'
    }
  }

  const hasSelection = selectedShapeIds.length > 0
  const hasClipboard = !!useStore((s) => s.clipboard)

  const isNodeMode = editMode === 'node'
  const hasSelectedNode = selectedNodeRef.current !== null

  const ctxMenuItems: { label: string; action: () => void; disabled?: boolean; separator?: boolean }[] = [
    ...(isNodeMode
      ? [
        { label: 'Bevel corner…', action: () => bevelSelectedNodePrompt(), disabled: !hasSelectedNode },
        { label: '', action: () => {}, separator: true },
      ]
      : []),
    { label: 'Cut', action: () => { handleCopy(); deleteSelected() }, disabled: !hasSelection },
    { label: 'Copy', action: () => handleCopy(), disabled: !hasSelection },
    { label: 'Paste', action: () => handlePaste(), disabled: !hasClipboard },
    { label: 'Duplicate', action: () => handleDuplicate(), disabled: !hasSelection },
    { label: '', action: () => {}, separator: true },
    { label: 'Delete', action: () => deleteSelected(), disabled: !hasSelection },
    { label: 'Select All', action: () => useStore.getState().setSelectedShapeIds(shapes.map(s => s.id)) },
    { label: '', action: () => {}, separator: true },
    { label: 'Bring Forward', action: () => { const s = useStore.getState(); for (const sid of s.selectedShapeIds) s.bringForward(sid); reorderPaperItems(); saveHistory('Reorder') }, disabled: !hasSelection },
    { label: 'Send Backward', action: () => { const s = useStore.getState(); for (const sid of [...s.selectedShapeIds].reverse()) s.sendBackward(sid); reorderPaperItems(); saveHistory('Reorder') }, disabled: !hasSelection },
    { label: 'Bring to Front', action: () => { const s = useStore.getState(); for (const sid of s.selectedShapeIds) s.bringToFront(sid); reorderPaperItems(); saveHistory('Reorder') }, disabled: !hasSelection },
    { label: 'Send to Back', action: () => { const s = useStore.getState(); for (const sid of [...s.selectedShapeIds].reverse()) s.sendToBack(sid); reorderPaperItems(); saveHistory('Reorder') }, disabled: !hasSelection },
    { label: '', action: () => {}, separator: true },
    { label: 'Group (Ctrl+G)', action: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true })) }, disabled: selectedShapeIds.length < 2 },
    { label: 'Ungroup (Ctrl+Shift+G)', action: () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true })) }, disabled: !selectedShapeIds.some(sid => shapes.find(s => s.id === sid)?.isGroup) },
  ]

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Horizontal ruler */}
      <div style={{ display: 'flex', flexShrink: 0 }}>
        <div style={{ width: RULER_SIZE, height: RULER_SIZE, background: '#12121f', borderRight: '1px solid #2a2a3e', borderBottom: '1px solid #2a2a3e', boxSizing: 'border-box' }} />
        <canvas
          ref={hRulerRef}
          style={{ flex: 1, height: RULER_SIZE, display: 'block' }}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Vertical ruler */}
        <canvas
          ref={vRulerRef}
          style={{ width: RULER_SIZE, display: 'block', flexShrink: 0 }}
        />
        {/* Canvas area */}
        <div
          ref={containerRef}
          style={{
            flex: 1, position: 'relative', overflow: 'hidden',
            background: showCheckerboard
              ? `repeating-conic-gradient(#808080 0% 25%, #c0c0c0 0% 50%) 0 0 / 20px 20px`
              : canvasBgColor,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ display: 'block', cursor: getCursorStyle() }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onContextMenu={onContextMenu}
          />
      {contextMenu && (
        <div
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
          onClick={() => setContextMenu(null)}
        >
          <div style={ctxStyles.menu}>
            {ctxMenuItems.map((item, i) =>
              item.separator ? (
                <div key={i} style={ctxStyles.separator} />
              ) : (
                <button
                  key={i}
                  style={{ ...ctxStyles.item, opacity: item.disabled ? 0.4 : 1 }}
                  disabled={item.disabled}
                  onClick={(e) => { e.stopPropagation(); item.action(); setContextMenu(null) }}
                >
                  {item.label}
                </button>
              )
            )}
          </div>
        </div>
      )}
      {dimTooltip && (
        <div
          style={{
            position: 'fixed',
            left: dimTooltip.x,
            top: dimTooltip.y,
            background: '#1e1e3a',
            border: '1px solid #6a6aff',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 11,
            color: '#e0e0f0',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 9998,
            whiteSpace: 'nowrap',
          }}
        >
          {dimTooltip.text}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

const ctxStyles: Record<string, React.CSSProperties> = {
  menu: {
    background: '#1e1e3a', border: '1px solid #3a3a5e', borderRadius: 6, padding: '4px 0',
    minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  item: {
    display: 'block', width: '100%', padding: '5px 14px', fontSize: 12, color: '#ccc',
    background: 'none', border: 'none', textAlign: 'left' as const, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  separator: {
    height: 1, background: '#3a3a5e', margin: '4px 0',
  },
}

/** Draw grid lines/dots into the dedicated grid layer */
function drawGrid(scope: paper.PaperScope, gridLayer: paper.Layer | null) {
  if (!gridLayer) return

  // Remember current active layer
  const prevActive = scope.project.activeLayer

  gridLayer.activate()
  gridLayer.removeChildren()

  const { snapToGrid, gridSize } = useStore.getState()

  if (snapToGrid && gridSize > 0) {
    // Draw snap grid dots in project space visible in current viewport
    const view = scope.view
    const zoom = view.zoom
    const tl = view.bounds.topLeft
    const br = view.bounds.bottomRight

    // Calculate grid start/end aligned to gridSize
    const startX = Math.floor(tl.x / gridSize) * gridSize
    const startY = Math.floor(tl.y / gridSize) * gridSize
    const endX = Math.ceil(br.x / gridSize) * gridSize
    const endY = Math.ceil(br.y / gridSize) * gridSize

    // Limit max dots to avoid freezing
    const cols = Math.min((endX - startX) / gridSize + 1, 200)
    const rows = Math.min((endY - startY) / gridSize + 1, 200)

    const dotRadius = Math.max(0.8, 1.2 / zoom)
    const dotColor = new paper.Color('#4a4a6e')

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const gx = startX + i * gridSize
        const gy = startY + j * gridSize
        const dot = new paper.Path.Circle({
          center: new paper.Point(gx, gy),
          radius: dotRadius,
          fillColor: dotColor,
        })
        dot.data = { isOverlay: true }
      }
    }
  } else {
    // Default subtle background grid (screen space)
    const size = scope.view.viewSize
    const step = 20
    for (let x = 0; x < size.width; x += step) {
      new paper.Path.Line({
        from: new paper.Point(x, 0),
        to: new paper.Point(x, size.height),
        strokeColor: new paper.Color('#1a1a2e'),
        strokeWidth: 0.5,
      })
    }
    for (let y = 0; y < size.height; y += step) {
      new paper.Path.Line({
        from: new paper.Point(0, y),
        to: new paper.Point(size.width, y),
        strokeColor: new paper.Color('#1a1a2e'),
        strokeWidth: 0.5,
      })
    }
  }

  // Restore previous active layer
  prevActive.activate()
}

const RULER_SIZE = 20 // px

/** Draw rulers along top and left edges. */
function drawRulers(
  scope: paper.PaperScope,
  hCanvas: HTMLCanvasElement | null,
  vCanvas: HTMLCanvasElement | null,
) {
  if (!hCanvas || !vCanvas) return
  const dpr = window.devicePixelRatio || 1
  const view = scope.view
  const zoom = view.zoom

  // --- pick a nice tick interval based on zoom ---
  const minPixels = 50 // minimum pixels between major ticks
  const rawInterval = minPixels / zoom
  const mag = Math.pow(10, Math.floor(Math.log10(rawInterval)))
  const residual = rawInterval / mag
  const niceMultiplier = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  const majorStep = niceMultiplier * mag
  const minorDivisions = niceMultiplier === 10 ? 5 : niceMultiplier === 5 ? 5 : 4
  const minorStep = majorStep / minorDivisions

  // --- Horizontal ruler ---
  {
    const w = hCanvas.clientWidth
    const h = RULER_SIZE
    hCanvas.width = Math.round(w * dpr)
    hCanvas.height = Math.round(h * dpr)
    const ctx = hCanvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#12121f'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#2a2a3e'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h - 0.5)
    ctx.lineTo(w, h - 0.5)
    ctx.stroke()

    const leftProj = view.viewToProject(new paper.Point(0, 0)).x
    const rightProj = view.viewToProject(new paper.Point(w, 0)).x

    const startMinor = Math.floor(leftProj / minorStep) * minorStep
    ctx.strokeStyle = '#2a2a4e'
    ctx.lineWidth = 0.5
    for (let val = startMinor; val <= rightProj; val += minorStep) {
      const sx = (val - leftProj) * zoom
      ctx.beginPath()
      ctx.moveTo(sx, h - 4)
      ctx.lineTo(sx, h)
      ctx.stroke()
    }
    const startMajor = Math.floor(leftProj / majorStep) * majorStep
    ctx.strokeStyle = '#4a4a6e'
    ctx.lineWidth = 1
    ctx.fillStyle = '#6a6a8e'
    ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    for (let val = startMajor; val <= rightProj; val += majorStep) {
      const sx = (val - leftProj) * zoom
      ctx.beginPath()
      ctx.moveTo(sx, h - 8)
      ctx.lineTo(sx, h)
      ctx.stroke()
      ctx.fillText(String(Math.round(val)), sx + 2, 10)
    }
  }

  // --- Vertical ruler ---
  {
    const w = RULER_SIZE
    const h = vCanvas.clientHeight
    vCanvas.width = Math.round(w * dpr)
    vCanvas.height = Math.round(h * dpr)
    const ctx = vCanvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#12121f'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#2a2a3e'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(w - 0.5, 0)
    ctx.lineTo(w - 0.5, h)
    ctx.stroke()

    const topProj = view.viewToProject(new paper.Point(0, 0)).y
    const bottomProj = view.viewToProject(new paper.Point(0, h)).y

    const startMinor = Math.floor(topProj / minorStep) * minorStep
    ctx.strokeStyle = '#2a2a4e'
    ctx.lineWidth = 0.5
    for (let val = startMinor; val <= bottomProj; val += minorStep) {
      const sy = (val - topProj) * zoom
      ctx.beginPath()
      ctx.moveTo(w - 4, sy)
      ctx.lineTo(w, sy)
      ctx.stroke()
    }
    const startMajor = Math.floor(topProj / majorStep) * majorStep
    ctx.strokeStyle = '#4a4a6e'
    ctx.lineWidth = 1
    ctx.fillStyle = '#6a6a8e'
    ctx.font = '9px monospace'
    for (let val = startMajor; val <= bottomProj; val += majorStep) {
      const sy = (val - topProj) * zoom
      ctx.beginPath()
      ctx.moveTo(w - 8, sy)
      ctx.lineTo(w, sy)
      ctx.stroke()
      ctx.save()
      ctx.translate(2, sy + 2)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'right'
      ctx.fillText(String(Math.round(val)), 0, 8)
      ctx.restore()
    }
  }
}

