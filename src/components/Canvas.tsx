import React, { useRef, useEffect, useCallback } from 'react'
import paper from 'paper'
import { useStore } from '../store'
import {
  initEngine, getProject, getDrawLayer, nextId, applyStyle,
  createRectangle, createCircle, createRoundedRect, createPolygon, createStar,
} from '../engine'
import type { ShapeItem, HistoryEntry } from '../types'

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
  const penDraggingRef = useRef(false)
  const penLastPointRef = useRef<paper.Point | null>(null)
  const handleGuideRef = useRef<paper.Group | null>(null)
  const selectionOverlayRef = useRef<paper.Group | null>(null)
  const nodeOverlayRef = useRef<paper.Group | null>(null)
  const draggingNodeRef = useRef<{ segIndex: number; part: 'point' | 'handleIn' | 'handleOut' } | null>(null)

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

  // Refs to always have latest values in event handlers
  const activeToolRef = useRef(activeTool)
  const currentStyleRef = useRef(currentStyle)
  const penPathRef = useRef(penPath)
  const editModeRef = useRef(editMode)
  const editingShapeIdRef = useRef(editingShapeId)
  activeToolRef.current = activeTool
  currentStyleRef.current = currentStyle
  penPathRef.current = penPath
  editModeRef.current = editMode
  editingShapeIdRef.current = editingShapeId

  const saveHistory = useCallback((desc: string) => {
    const project = getProject()
    const json = project.exportJSON()
    pushHistory({ json, shapes: useStore.getState().shapes, description: desc })
  }, [pushHistory])

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
  }, [])

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

    // Also handle DPI changes (e.g. dragging between monitors)
    const mqDpr = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onDprChange = () => resizeCanvas(scope)
    mqDpr.addEventListener('change', onDprChange)

    return () => {
      ro.disconnect()
      mqDpr.removeEventListener('change', onDprChange)
    }
  }, [saveHistory, resizeCanvas])

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

    let globalIdx = 0
    for (let pi = 0; pi < paths.length; pi++) {
      const path = paths[pi]
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        const pt = seg.point
        const idx = globalIdx++

        // Draw bezier handle lines and dots
        if (seg.handleIn && seg.handleIn.length > 0) {
          const hPt = pt.add(seg.handleIn)
          const line = new paper.Path.Line({
            from: pt, to: hPt,
            strokeColor: new paper.Color('#ff6600'),
            strokeWidth: 1,
            dashArray: [3, 3],
          })
          line.data = { isOverlay: true }
          group.addChild(line)
          const dot = new paper.Path.Circle({
            center: hPt, radius: 4,
            fillColor: new paper.Color('#ff6600'),
            strokeColor: new paper.Color('#ffffff'),
            strokeWidth: 0.5,
          })
          dot.data = { isOverlay: true, nodeType: 'handleIn', segIndex: idx, pathIndex: pi }
          group.addChild(dot)
        }

        if (seg.handleOut && seg.handleOut.length > 0) {
          const hPt = pt.add(seg.handleOut)
          const line = new paper.Path.Line({
            from: pt, to: hPt,
            strokeColor: new paper.Color('#ff6600'),
            strokeWidth: 1,
            dashArray: [3, 3],
          })
          line.data = { isOverlay: true }
          group.addChild(line)
          const dot = new paper.Path.Circle({
            center: hPt, radius: 4,
            fillColor: new paper.Color('#ff6600'),
            strokeColor: new paper.Color('#ffffff'),
            strokeWidth: 0.5,
          })
          dot.data = { isOverlay: true, nodeType: 'handleOut', segIndex: idx, pathIndex: pi }
          group.addChild(dot)
        }

        // Draw segment point as a square
        const square = new paper.Path.Rectangle({
          point: new paper.Point(pt.x - 4, pt.y - 4),
          size: new paper.Size(8, 8),
          fillColor: new paper.Color('#ffffff'),
          strokeColor: new paper.Color('#6a6aff'),
          strokeWidth: 1.5,
        })
        square.data = { isOverlay: true, nodeType: 'point', segIndex: idx, pathIndex: pi }
        group.addChild(square)
      }
    }

    nodeOverlayRef.current = group
  }, [])

  // Mouse handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()
    activateDrawLayer()
    const viewPoint = toProjectPoint(e)
    const tool = activeToolRef.current

    // Node edit mode: check if clicking a node handle
    if (editModeRef.current === 'node' && tool === 'select') {
      const overlay = nodeOverlayRef.current
      if (overlay) {
        const hitResult = overlay.hitTest(viewPoint, { fill: true, tolerance: 10 })
        if (hitResult?.item?.data?.nodeType) {
          const { nodeType, segIndex } = hitResult.item.data
          draggingNodeRef.current = { segIndex, part: nodeType }
          dragStartRef.current = viewPoint
          return
        }
      }
      // Clicked outside nodes — check if still on the shape
      const drawLayer = getDrawLayer()
      const hitResult = drawLayer.hitTest(viewPoint, { fill: true, stroke: true, tolerance: 8 })
      const hitItem = hitTestShape(drawLayer, hitResult)
      if (!hitItem || hitItem.data?.shapeId !== editingShapeIdRef.current) {
        // Clicked outside the editing shape — exit node edit
        useStore.getState().exitNodeEdit()
      }
      return
    }

    if (tool === 'pen') {
      handlePenDown(viewPoint)
      return
    }

    if (tool === 'select') {
      handleSelectDown(viewPoint, e.shiftKey)
      return
    }

    // Shape tools: start drag
    dragStartRef.current = viewPoint
  }, [toProjectPoint, activateDrawLayer])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()
    activateDrawLayer()
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
        seg.handleIn = viewPoint.subtract(seg.point)
      } else if (part === 'handleOut') {
        seg.handleOut = viewPoint.subtract(seg.point)
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

    if (!dragStartRef.current) return

    if (tool === 'select' && selectedItemRef.current && dragOffsetRef.current) {
      selectedItemRef.current.position = viewPoint.add(dragOffsetRef.current)
      return
    }

    // Preview shape
    if (previewRef.current) {
      previewRef.current.remove()
      previewRef.current = null
    }

    const style = currentStyleRef.current
    const from = dragStartRef.current
    const to = viewPoint

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
    }
  }, [toProjectPoint, activateDrawLayer, drawNodeOverlay])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()
    activateDrawLayer()

    // Node edit mode: finish dragging
    if (draggingNodeRef.current) {
      draggingNodeRef.current = null
      dragStartRef.current = null
      saveHistory('Edit node')
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
      dragOffsetRef.current = null
      return
    }

    if (!dragStartRef.current) return
    const viewPoint = toProjectPoint(e)

    // Remove preview
    if (previewRef.current) {
      previewRef.current.remove()
      previewRef.current = null
    }

    // Finalize shape
    finalizeShape(dragStartRef.current, viewPoint)
    dragStartRef.current = null
  }, [toProjectPoint, activateDrawLayer, saveHistory])

  const finalizeShape = useCallback((from: paper.Point, to: paper.Point) => {
    const style = currentStyleRef.current
    const tool = activeToolRef.current
    let item: paper.Item | null = null

    switch (tool) {
      case 'rectangle':
        item = createRectangle(from, to, style)
        break
      case 'circle': {
        const radius = from.getDistance(to) / 2
        const center = from.add(to).divide(2)
        item = createCircle(center, Math.max(radius, 5), style)
        break
      }
      case 'roundedRect':
        item = createRoundedRect(from, to, 12, style)
        break
      case 'polygon': {
        const r = from.getDistance(to) / 2
        const c = from.add(to).divide(2)
        item = createPolygon(c, 6, Math.max(r, 5), style)
        break
      }
      case 'star': {
        const r2 = from.getDistance(to) / 2
        const c2 = from.add(to).divide(2)
        item = createStar(c2, 5, r2 * 0.4, Math.max(r2, 5), style)
        break
      }
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
      }
      addShape(shapeItem)
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
      selectedItemRef.current = hitItem
      dragStartRef.current = point
      dragOffsetRef.current = hitItem.position.subtract(point)

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
      setSelectedShapeIds([])
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
    const onKey = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        const entry = useStore.getState().undo()
        if (entry) restoreHistory(entry)
      }
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        const entry = useStore.getState().redo()
        if (entry) restoreHistory(entry)
      }
      if (e.key === 'v' || e.key === 'V') setActiveTool('select')
      if (e.key === 'r' || e.key === 'R') setActiveTool('rectangle')
      if (e.key === 'o' || e.key === 'O') setActiveTool('circle')
      if (e.key === 'p' || e.key === 'P') setActiveTool('pen')
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      }
      if (e.key === 'Escape') {
        // Exit node edit mode first
        if (editModeRef.current === 'node') {
          useStore.getState().exitNodeEdit()
          return
        }
        // Cancel pen path
        if (penPathRef.current !== null) {
          const existing = getProject().activeLayer.children.find(
            (c) => c.id === penPathRef.current
          )
          if (existing) existing.remove()
          setPenPath(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setActiveTool, setPenPath])

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

  // Draw selection highlights around selected shapes
  useEffect(() => {
    const scope = scopeRef.current
    if (!scope) return
    scope.activate()

    // Remove old selection overlay
    if (selectionOverlayRef.current) {
      selectionOverlayRef.current.remove()
      selectionOverlayRef.current = null
    }

    if (selectedShapeIds.length === 0) return

    const drawLayer = getDrawLayer()

    const group = new paper.Group()
    group.data = { isOverlay: true }

    for (const sid of selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (!item) continue
      const bounds = item.bounds
      const rect = new paper.Path.Rectangle({
        rectangle: bounds.expand(4),
        strokeColor: new paper.Color('#6a6aff'),
        strokeWidth: 1,
        dashArray: [4, 3],
        fillColor: null as any,
      })
      rect.data = { isOverlay: true }
      group.addChild(rect)
    }

    selectionOverlayRef.current = group
  }, [selectedShapeIds, shapes])

  // Trigger node overlay redraw when edit mode changes
  useEffect(() => {
    drawNodeOverlay()
  }, [editMode, editingShapeId, shapes, drawNodeOverlay])

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0d0d1a' }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: editMode === 'node' ? 'move' : getCursor(activeTool) }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  )
}

function getCursor(tool: string): string {
  switch (tool) {
    case 'select': return 'default'
    case 'pen': return 'crosshair'
    default: return 'crosshair'
  }
}

/** Draw grid lines into the dedicated grid layer */
function drawGrid(scope: paper.PaperScope, gridLayer: paper.Layer | null) {
  if (!gridLayer) return

  // Remember current active layer
  const prevActive = scope.project.activeLayer

  gridLayer.activate()
  gridLayer.removeChildren()

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

  // Restore previous active layer
  prevActive.activate()
}

