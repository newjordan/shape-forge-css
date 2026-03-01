import React, { useState, useEffect, useCallback, useRef } from 'react'
import paper from 'paper'
import { useStore } from '../store'
import { STYLE_PRESETS } from '../types'
import type { ShapeStyle, PrimitiveParams } from '../types'
import { getDrawLayer, applyStyle, drawArrowMarkers, regeneratePrimitive, exportHistoryJSON } from '../engine'

export default function PropertiesPanel() {
  const currentStyle = useStore((s) => s.currentStyle)
  const setCurrentStyle = useStore((s) => s.setCurrentStyle)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)
  const shapes = useStore((s) => s.shapes)
  const updateShape = useStore((s) => s.updateShape)
  const pushHistory = useStore((s) => s.pushHistory)
  const canvasBgColor = useStore((s) => s.canvasBgColor)
  const setCanvasBgColor = useStore((s) => s.setCanvasBgColor)
  const snapToGrid = useStore((s) => s.snapToGrid)
  const setSnapToGrid = useStore((s) => s.setSnapToGrid)
  const gridSize = useStore((s) => s.gridSize)
  const setGridSize = useStore((s) => s.setGridSize)
  const showSmartGuides = useStore((s) => s.showSmartGuides)
  const setShowSmartGuides = useStore((s) => s.setShowSmartGuides)
  const showCheckerboard = useStore((s) => s.showCheckerboard)
  const setShowCheckerboard = useStore((s) => s.setShowCheckerboard)
  const recentColors = useStore((s) => s.recentColors)

  // Helper: snapshot the entire project for undo history
  const saveHistory = useCallback((desc: string) => {
    try {
			const json = exportHistoryJSON()
      pushHistory({ json, shapes: useStore.getState().shapes, description: desc })
    } catch { /* engine not yet initialised */ }
  }, [pushHistory])

  // Debounce timer for slider/continuous changes
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSaveHistory = useCallback((desc: string) => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current)
    historyTimerRef.current = setTimeout(() => saveHistory(desc), 400)
  }, [saveHistory])

  // Transform state
  const [posX, setPosX] = useState(0)
  const [posY, setPosY] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [scaleX, setScaleX] = useState(1)
  const [scaleY, setScaleY] = useState(1)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [lockAspect, setLockAspect] = useState(true)

  const getSelectedItem = useCallback((): paper.Item | null => {
    if (selectedShapeIds.length !== 1) return null
    try {
      const drawLayer = getDrawLayer()
      return drawLayer.children.find((c) => c.data?.shapeId === selectedShapeIds[0]) ?? null
    } catch { return null }
  }, [selectedShapeIds])

  // Read transform values from the selected item
  useEffect(() => {
    const item = getSelectedItem()
    if (!item) return
    setPosX(Math.round(item.position.x * 10) / 10)
    setPosY(Math.round(item.position.y * 10) / 10)
    setRotation(Math.round((item.rotation ?? 0) * 10) / 10)
    const sc = item.scaling ?? new paper.Point(1, 1)
    setScaleX(Math.round(sc.x * 100) / 100)
    setScaleY(Math.round(sc.y * 100) / 100)
    setWidth(Math.round(item.bounds.width * 10) / 10)
    setHeight(Math.round(item.bounds.height * 10) / 10)
  }, [selectedShapeIds, shapes, getSelectedItem])

  const applyToSelected = (style: Partial<ShapeStyle>) => {
    setCurrentStyle(style)
    const drawLayer = getDrawLayer()
    const fullStyle = { ...currentStyle, ...style }
    for (const sid of selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (item) {
        applyStyle(item, fullStyle)
        updateShape(sid, { style: fullStyle })
        // Update arrow markers if arrow properties changed
        if ('arrowStart' in style || 'arrowEnd' in style || 'strokeColor' in style || 'strokeWidth' in style) {
          // Remove old arrow markers
          const oldMarkers = drawLayer.children.filter((c) => c.data?.isArrowMarker && c.data?.forShapeId === sid)
          oldMarkers.forEach((m) => m.remove())
          // Draw new arrow markers
          const markerGrp = drawArrowMarkers(item, fullStyle)
          if (markerGrp) {
            markerGrp.data = { isArrowMarker: true, forShapeId: sid, isOverlay: true }
          }
        }
      }
    }
    // Track recent colors
    if (style.fillColor) useStore.getState().addRecentColor(style.fillColor)
    if (style.strokeColor) useStore.getState().addRecentColor(style.strokeColor)
    debouncedSaveHistory('Style change')
  }

  const applyTransform = useCallback((fn: (item: paper.Item) => void) => {
    const item = getSelectedItem()
    if (!item) return
    fn(item)
    // Re-read values after applying
    setPosX(Math.round(item.position.x * 10) / 10)
    setPosY(Math.round(item.position.y * 10) / 10)
    setRotation(Math.round((item.rotation ?? 0) * 10) / 10)
    const sc = item.scaling ?? new paper.Point(1, 1)
    setScaleX(Math.round(sc.x * 100) / 100)
    setScaleY(Math.round(sc.y * 100) / 100)
    setWidth(Math.round(item.bounds.width * 10) / 10)
    setHeight(Math.round(item.bounds.height * 10) / 10)
    debouncedSaveHistory('Transform')
  }, [getSelectedItem, debouncedSaveHistory])

  const hasSingleSelection = selectedShapeIds.length === 1

  // Primitive-specific controls
  const selectedShape = hasSingleSelection
    ? shapes.find((s) => s.id === selectedShapeIds[0])
    : null
  const primType = selectedShape?.primitiveType
  const primParams = selectedShape?.primitiveParams

  const applyPrimitiveChange = useCallback((newParams: PrimitiveParams) => {
    if (!selectedShape?.primitiveType) return
    const drawLayer = getDrawLayer()
    const item = drawLayer.children.find((c) => c.data?.shapeId === selectedShape.id)
    if (!item) return
    const mergedParams = { ...selectedShape.primitiveParams, ...newParams }
    const newItem = regeneratePrimitive(item, selectedShape.primitiveType, mergedParams, selectedShape.style)
    if (newItem) {
      updateShape(selectedShape.id, {
        paperItemId: newItem.id,
        primitiveParams: mergedParams,
      })
      debouncedSaveHistory('Edit primitive')
    }
  }, [selectedShape, updateShape, debouncedSaveHistory])

  // --- Alignment ---
  const getSelectedItems = useCallback((): paper.Item[] => {
    try {
      const drawLayer = getDrawLayer()
      return selectedShapeIds.map((sid) =>
        drawLayer.children.find((c) => c.data?.shapeId === sid)
      ).filter(Boolean) as paper.Item[]
    } catch { return [] }
  }, [selectedShapeIds])

  const handleAlign = useCallback((action: 'left' | 'right' | 'centerH' | 'top' | 'bottom' | 'centerV') => {
    const items = getSelectedItems()
    if (items.length < 2) return
    const bounds = items.map((it) => it.bounds)
    switch (action) {
      case 'left': { const min = Math.min(...bounds.map((b) => b.left)); items.forEach((it) => { it.position = it.position.add(new paper.Point(min - it.bounds.left, 0)) }); break }
      case 'right': { const max = Math.max(...bounds.map((b) => b.right)); items.forEach((it) => { it.position = it.position.add(new paper.Point(max - it.bounds.right, 0)) }); break }
      case 'centerH': { const avg = bounds.reduce((s, b) => s + b.center.x, 0) / bounds.length; items.forEach((it) => { it.position = it.position.add(new paper.Point(avg - it.bounds.center.x, 0)) }); break }
      case 'top': { const min = Math.min(...bounds.map((b) => b.top)); items.forEach((it) => { it.position = it.position.add(new paper.Point(0, min - it.bounds.top)) }); break }
      case 'bottom': { const max = Math.max(...bounds.map((b) => b.bottom)); items.forEach((it) => { it.position = it.position.add(new paper.Point(0, max - it.bounds.bottom)) }); break }
      case 'centerV': { const avg = bounds.reduce((s, b) => s + b.center.y, 0) / bounds.length; items.forEach((it) => { it.position = it.position.add(new paper.Point(0, avg - it.bounds.center.y)) }); break }
    }
    saveHistory(`Align ${action}`)
  }, [getSelectedItems, saveHistory])

  const handleDistribute = useCallback((direction: 'horizontal' | 'vertical') => {
    const items = getSelectedItems()
    if (items.length < 3) return
    if (direction === 'horizontal') {
      items.sort((a, b) => a.bounds.center.x - b.bounds.center.x)
      const first = items[0].bounds.center.x
      const last = items[items.length - 1].bounds.center.x
      const step = (last - first) / (items.length - 1)
      items.forEach((it, i) => { it.position = it.position.add(new paper.Point(first + step * i - it.bounds.center.x, 0)) })
    } else {
      items.sort((a, b) => a.bounds.center.y - b.bounds.center.y)
      const first = items[0].bounds.center.y
      const last = items[items.length - 1].bounds.center.y
      const step = (last - first) / (items.length - 1)
      items.forEach((it, i) => { it.position = it.position.add(new paper.Point(0, first + step * i - it.bounds.center.y)) })
    }
    saveHistory(`Distribute ${direction}`)
  }, [getSelectedItems, saveHistory])

  // Shape info computation
  const shapeInfoText = React.useMemo(() => {
    if (!hasSingleSelection || !selectedShape) return null
    try {
      const drawLayer = getDrawLayer()
      const item = drawLayer.children.find((c) => c.data?.shapeId === selectedShape.id)
      if (!item) return null
      const b = item.bounds
      const type = selectedShape.isGroup ? 'Group' : selectedShape.textContent !== undefined ? 'Text' : selectedShape.primitiveType ?? 'path'
      let nodes = 0
      if (item instanceof paper.Path) nodes = item.segments.length
      else if (item instanceof paper.CompoundPath) nodes = (item as paper.CompoundPath).children.reduce((s, c) => s + ((c as paper.Path).segments?.length ?? 0), 0)
      else if (item instanceof paper.PointText) nodes = (item.content || '').length
      return { type, nodes, w: Math.round(b.width), h: Math.round(b.height), isText: selectedShape.textContent !== undefined }
    } catch { return null }
  }, [hasSingleSelection, selectedShape, selectedShapeIds])

  return (
    <div style={styles.panel}>
      {/* SHAPE INFO section */}
      {hasSingleSelection && shapeInfoText && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>INFO</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#6a6a8e', background: '#1a1a2e', padding: '2px 8px', borderRadius: 3, border: '1px solid #2a2a3e' }}>
                {shapeInfoText.type}
              </span>
              <span style={{ fontSize: 10, color: '#6a6a8e', background: '#1a1a2e', padding: '2px 8px', borderRadius: 3, border: '1px solid #2a2a3e' }}>
                {shapeInfoText.w} × {shapeInfoText.h} px
              </span>
              <span style={{ fontSize: 10, color: '#6a6a8e', background: '#1a1a2e', padding: '2px 8px', borderRadius: 3, border: '1px solid #2a2a3e' }}>
                {shapeInfoText.isText ? `${shapeInfoText.nodes} chars` : `${shapeInfoText.nodes} nodes`}
              </span>
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {/* TRANSFORM section */}
      {hasSingleSelection && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>TRANSFORM</div>

            <div style={styles.row}>
              <label style={styles.label}>X</label>
              <input type="number" value={posX} step={1}
                style={styles.numInput}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0
                  setPosX(v)
                  applyTransform((item) => { item.position = new paper.Point(v, item.position.y) })
                }}
              />
              <label style={{ ...styles.label, width: 20, textAlign: 'center' as const }}>Y</label>
              <input type="number" value={posY} step={1}
                style={styles.numInput}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0
                  setPosY(v)
                  applyTransform((item) => { item.position = new paper.Point(item.position.x, v) })
                }}
              />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>W</label>
              <input type="number" value={width} min={1} step={1}
                style={styles.numInput}
                onChange={(e) => {
                  const v = Math.max(1, parseFloat(e.target.value) || 1)
                  setWidth(v)
                  applyTransform((item) => {
                    const ratio = v / item.bounds.width
                    if (lockAspect) {
                      item.scale(ratio)
                    } else {
                      item.scale(ratio, 1)
                    }
                  })
                }}
              />
              <label style={{ ...styles.label, width: 20, textAlign: 'center' as const }}>H</label>
              <input type="number" value={height} min={1} step={1}
                style={styles.numInput}
                onChange={(e) => {
                  const v = Math.max(1, parseFloat(e.target.value) || 1)
                  setHeight(v)
                  applyTransform((item) => {
                    const ratio = v / item.bounds.height
                    if (lockAspect) {
                      item.scale(ratio)
                    } else {
                      item.scale(1, ratio)
                    }
                  })
                }}
              />
            </div>

            <div style={styles.row}>
              <label style={{ ...styles.label, cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setLockAspect(!lockAspect)}
                title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              >
                {lockAspect ? '🔗 Lock' : '🔓 Free'}
              </label>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Rotate</label>
              <input type="range" min={-180} max={180} step={1}
                value={rotation}
                style={styles.slider}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  const oldRot = rotation
                  setRotation(v)
                  applyTransform((item) => { item.rotate(v - oldRot) })
                }}
              />
              <input type="number" value={rotation} step={1}
                style={{ ...styles.numInput, width: 48 }}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0
                  const oldRot = rotation
                  setRotation(v)
                  applyTransform((item) => { item.rotate(v - oldRot) })
                }}
              />
              <span style={styles.value}>°</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Scale X</label>
              <input type="range" min={0.1} max={3} step={0.01}
                value={scaleX}
                style={styles.slider}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  applyTransform((item) => {
                    const cur = item.scaling ?? new paper.Point(1, 1)
                    if (lockAspect) {
                      const ratio = v / cur.x
                      item.scale(ratio)
                    } else {
                      item.scaling = new paper.Point(v, cur.y)
                    }
                  })
                }}
              />
              <span style={styles.value}>{scaleX.toFixed(2)}</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Scale Y</label>
              <input type="range" min={0.1} max={3} step={0.01}
                value={scaleY}
                style={styles.slider}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  applyTransform((item) => {
                    const cur = item.scaling ?? new paper.Point(1, 1)
                    if (lockAspect) {
                      const ratio = v / cur.y
                      item.scale(ratio)
                    } else {
                      item.scaling = new paper.Point(cur.x, v)
                    }
                  })
                }}
              />
              <span style={styles.value}>{scaleY.toFixed(2)}</span>
            </div>

            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button
                style={styles.alignBtn}
                title="Flip Horizontal"
                onClick={() => applyTransform((item) => { item.scale(-1, 1) })}
              >↔ Flip H</button>
              <button
                style={styles.alignBtn}
                title="Flip Vertical"
                onClick={() => applyTransform((item) => { item.scale(1, -1) })}
              >↕ Flip V</button>
              <button
                style={styles.alignBtn}
                title="Simplify path — reduce node count while preserving shape"
                onClick={() => {
                  const item = getSelectedItem()
                  if (!item) return
                  if (item instanceof paper.Path) {
                    item.simplify(2.5)
                  } else if (item instanceof paper.CompoundPath) {
                    for (const child of item.children) {
                      if (child instanceof paper.Path) child.simplify(2.5)
                    }
                  }
                  saveHistory('Simplify path')
                }}
              >✂ Simplify</button>
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {/* PRIMITIVE CONTROLS */}
      {hasSingleSelection && primType === 'roundedRect' && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>CORNER RADIUS</div>
            <div style={styles.row}>
              <label style={styles.label}>Radius</label>
              <input type="range" min={0} max={100} step={1}
                value={primParams?.cornerRadius ?? 12}
                style={styles.slider}
                onChange={(e) => applyPrimitiveChange({ cornerRadius: parseFloat(e.target.value) })}
              />
              <input type="number" min={0} max={200} step={1}
                value={primParams?.cornerRadius ?? 12}
                style={{ ...styles.numInput, width: 48 }}
                onChange={(e) => applyPrimitiveChange({ cornerRadius: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {hasSingleSelection && primType === 'polygon' && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>POLYGON</div>
            <div style={styles.row}>
              <label style={styles.label}>Sides</label>
              <input type="range" min={3} max={24} step={1}
                value={primParams?.sides ?? 6}
                style={styles.slider}
                onChange={(e) => applyPrimitiveChange({ sides: parseInt(e.target.value) })}
              />
              <input type="number" min={3} max={100} step={1}
                value={primParams?.sides ?? 6}
                style={{ ...styles.numInput, width: 48 }}
                onChange={(e) => applyPrimitiveChange({ sides: Math.max(3, parseInt(e.target.value) || 3) })}
              />
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {hasSingleSelection && primType === 'star' && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>STAR</div>
            <div style={styles.row}>
              <label style={styles.label}>Points</label>
              <input type="range" min={3} max={24} step={1}
                value={primParams?.points ?? 5}
                style={styles.slider}
                onChange={(e) => applyPrimitiveChange({ points: parseInt(e.target.value) })}
              />
              <input type="number" min={3} max={50} step={1}
                value={primParams?.points ?? 5}
                style={{ ...styles.numInput, width: 48 }}
                onChange={(e) => applyPrimitiveChange({ points: Math.max(3, parseInt(e.target.value) || 3) })}
              />
            </div>
            <div style={styles.row}>
              <label style={styles.label}>Inner R</label>
              <input type="range" min={5} max={200} step={1}
                value={Math.round(primParams?.innerRadius ?? 20)}
                style={styles.slider}
                onChange={(e) => applyPrimitiveChange({ innerRadius: parseFloat(e.target.value) })}
              />
              <span style={styles.value}>{Math.round(primParams?.innerRadius ?? 20)}</span>
            </div>
            <div style={styles.row}>
              <label style={styles.label}>Outer R</label>
              <input type="range" min={10} max={300} step={1}
                value={Math.round(primParams?.outerRadius ?? 50)}
                style={styles.slider}
                onChange={(e) => applyPrimitiveChange({ outerRadius: parseFloat(e.target.value) })}
              />
              <span style={styles.value}>{Math.round(primParams?.outerRadius ?? 50)}</span>
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      {/* TEXT CONTROLS */}
      {hasSingleSelection && selectedShape?.textContent !== undefined && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>TEXT</div>
            <div style={styles.row}>
              <label style={styles.label}>Content</label>
              <input
                type="text"
                value={selectedShape.textContent ?? ''}
                onChange={(e) => {
                  const newText = e.target.value
                  const drawLayer = getDrawLayer()
                  const item = drawLayer.children.find((c) => c.data?.shapeId === selectedShape.id)
                  if (item && item instanceof paper.PointText) {
                    item.content = newText
                  }
                  updateShape(selectedShape.id, { textContent: newText })
                  debouncedSaveHistory('Edit text content')
                }}
                style={{ ...styles.numInput, flex: 1 }}
              />
            </div>
            <div style={styles.row}>
              <label style={styles.label}>Font Size</label>
              <input type="range" min={8} max={120} step={1}
                value={selectedShape.fontSize ?? 24}
                style={styles.slider}
                onChange={(e) => {
                  const newSize = parseFloat(e.target.value)
                  const drawLayer = getDrawLayer()
                  const item = drawLayer.children.find((c) => c.data?.shapeId === selectedShape.id)
                  if (item && item instanceof paper.PointText) {
                    item.fontSize = newSize
                  }
                  updateShape(selectedShape.id, { fontSize: newSize })
                  debouncedSaveHistory('Edit font size')
                }}
              />
              <input type="number" min={4} max={500} step={1}
                value={selectedShape.fontSize ?? 24}
                style={{ ...styles.numInput, width: 48 }}
                onChange={(e) => {
                  const newSize = Math.max(4, parseFloat(e.target.value) || 24)
                  const drawLayer = getDrawLayer()
                  const item = drawLayer.children.find((c) => c.data?.shapeId === selectedShape.id)
                  if (item && item instanceof paper.PointText) {
                    item.fontSize = newSize
                  }
                  updateShape(selectedShape.id, { fontSize: newSize })
                  debouncedSaveHistory('Edit font size')
                }}
              />
            </div>
            <div style={styles.row}>
              <label style={styles.label}>Font</label>
              <select
                value={selectedShape.fontFamily ?? 'sans-serif'}
                onChange={(e) => {
                  const newFont = e.target.value
                  const drawLayer = getDrawLayer()
                  const item = drawLayer.children.find((c) => c.data?.shapeId === selectedShape.id)
                  if (item && item instanceof paper.PointText) {
                    item.fontFamily = newFont
                  }
                  updateShape(selectedShape.id, { fontFamily: newFont })
                  debouncedSaveHistory('Edit font family')
                }}
                style={{ ...styles.numInput, flex: 1, fontFamily: selectedShape.fontFamily ?? 'sans-serif' }}
              >
                {['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'Arial', 'Georgia', 'Courier New', 'Times New Roman', 'Verdana', 'Impact'].map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={styles.divider} />
        </>
      )}

      <div style={styles.section}>
        <div style={styles.sectionTitle}>FILL & STROKE</div>

        <div style={styles.row}>
          <label style={styles.label}>Fill</label>
          <input
            type="color"
            value={currentStyle.fillColor || '#000000'}
            disabled={!currentStyle.fillColor}
            onChange={(e) => applyToSelected({ fillColor: e.target.value })}
            style={!currentStyle.fillColor ? { opacity: 0.3 } : undefined}
          />
          <button
            onClick={() => applyToSelected({ fillColor: currentStyle.fillColor ? null : '#4a9eff' })}
            style={{
              fontSize: 9,
              padding: '3px 7px',
              background: currentStyle.fillColor ? '#1a1a2e' : '#3a3a6e',
              borderRadius: 4,
              border: '1px solid #3a3a5e',
              color: currentStyle.fillColor ? '#8a8aae' : '#fff',
              whiteSpace: 'nowrap' as const,
            }}
            title={currentStyle.fillColor ? 'Remove fill (outline only)' : 'Add fill back'}
          >
            {currentStyle.fillColor ? 'No Fill' : '+ Fill'}
          </button>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Stroke</label>
          <input
            type="color"
            value={currentStyle.strokeColor}
            onChange={(e) => applyToSelected({ strokeColor: e.target.value })}
          />
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Stroke W</label>
          <input
            type="range"
            min={0} max={20} step={0.5}
            value={currentStyle.strokeWidth}
            onChange={(e) => applyToSelected({ strokeWidth: parseFloat(e.target.value) })}
            style={styles.slider}
          />
          <span style={styles.value}>{currentStyle.strokeWidth}</span>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Dash</label>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {([
              { label: '—', value: null, title: 'Solid' },
              { label: '- -', value: [8, 4], title: 'Dashed' },
              { label: '···', value: [2, 4], title: 'Dotted' },
              { label: '-·-', value: [8, 4, 2, 4], title: 'Dash-dot' },
            ] as { label: string; value: number[] | null; title: string }[]).map((opt) => {
              const isActive = JSON.stringify(currentStyle.dashArray ?? null) === JSON.stringify(opt.value)
              return (
                <button
                  key={opt.title}
                  onClick={() => applyToSelected({ dashArray: opt.value })}
                  title={opt.title}
                  style={{
                    flex: 1, padding: '3px 4px', fontSize: 10, fontWeight: 600,
                    background: isActive ? '#3a3a6e' : '#1a1a2e',
                    border: `1px solid ${isActive ? '#6a6aff' : '#2a2a3e'}`,
                    borderRadius: 3, color: isActive ? '#fff' : '#8a8aae', cursor: 'pointer',
                    letterSpacing: '0.05em',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Cap</label>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {(['butt', 'round', 'square'] as const).map((cap) => {
              const isActive = (currentStyle.strokeCap || 'butt') === cap
              return (
                <button
                  key={cap}
                  onClick={() => applyToSelected({ strokeCap: cap })}
                  title={cap.charAt(0).toUpperCase() + cap.slice(1)}
                  style={{
                    flex: 1, padding: '3px 4px', fontSize: 10, fontWeight: 600,
                    background: isActive ? '#3a3a6e' : '#1a1a2e',
                    border: `1px solid ${isActive ? '#6a6aff' : '#2a2a3e'}`,
                    borderRadius: 3, color: isActive ? '#fff' : '#8a8aae', cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {cap}
                </button>
              )
            })}
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Join</label>
          <div style={{ display: 'flex', gap: 3, flex: 1 }}>
            {(['miter', 'round', 'bevel'] as const).map((join) => {
              const isActive = (currentStyle.strokeJoin || 'miter') === join
              return (
                <button
                  key={join}
                  onClick={() => applyToSelected({ strokeJoin: join })}
                  title={join.charAt(0).toUpperCase() + join.slice(1)}
                  style={{
                    flex: 1, padding: '3px 4px', fontSize: 10, fontWeight: 600,
                    background: isActive ? '#3a3a6e' : '#1a1a2e',
                    border: `1px solid ${isActive ? '#6a6aff' : '#2a2a3e'}`,
                    borderRadius: 3, color: isActive ? '#fff' : '#8a8aae', cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {join}
                </button>
              )
            })}
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Arrows</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#aaa', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!currentStyle.arrowStart}
                onChange={(e) => applyToSelected({ arrowStart: e.target.checked })}
              />
              Start ◄
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#aaa', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!currentStyle.arrowEnd}
                onChange={(e) => applyToSelected({ arrowEnd: e.target.checked })}
              />
              End ►
            </label>
          </div>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Opacity</label>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={currentStyle.opacity}
            onChange={(e) => applyToSelected({ opacity: parseFloat(e.target.value) })}
            style={styles.slider}
          />
          <span style={styles.value}>{currentStyle.opacity.toFixed(2)}</span>
        </div>

        <div style={styles.row}>
          <label style={styles.label}>Shadow</label>
          <input
            type="color"
            value={currentStyle.shadowColor || '#000000'}
            disabled={!currentStyle.shadowColor}
            onChange={(e) => applyToSelected({ shadowColor: e.target.value })}
            style={!currentStyle.shadowColor ? { opacity: 0.3 } : undefined}
          />
          <button
            onClick={() => applyToSelected({
              shadowColor: currentStyle.shadowColor ? null : '#000000',
              shadowBlur: currentStyle.shadowColor ? 0 : 10,
              shadowOffsetX: currentStyle.shadowColor ? 0 : 3,
              shadowOffsetY: currentStyle.shadowColor ? 0 : 3,
            })}
            style={{
              fontSize: 9, padding: '3px 7px',
              background: currentStyle.shadowColor ? '#1a1a2e' : '#3a3a6e',
              borderRadius: 4, border: '1px solid #3a3a5e',
              color: currentStyle.shadowColor ? '#8a8aae' : '#fff',
              whiteSpace: 'nowrap' as const, cursor: 'pointer',
            }}
            title={currentStyle.shadowColor ? 'Remove shadow' : 'Add shadow'}
          >
            {currentStyle.shadowColor ? 'No Shadow' : '+ Shadow'}
          </button>
        </div>
        {currentStyle.shadowColor && (
          <>
            <div style={styles.row}>
              <label style={styles.label}>Blur</label>
              <input
                type="range" min={0} max={50} step={1}
                value={currentStyle.shadowBlur ?? 0}
                onChange={(e) => applyToSelected({ shadowBlur: parseFloat(e.target.value) })}
                style={styles.slider}
              />
              <span style={styles.value}>{currentStyle.shadowBlur ?? 0}</span>
            </div>
            <div style={styles.row}>
              <label style={styles.label}>Offset X</label>
              <input
                type="range" min={-30} max={30} step={1}
                value={currentStyle.shadowOffsetX ?? 0}
                onChange={(e) => applyToSelected({ shadowOffsetX: parseFloat(e.target.value) })}
                style={styles.slider}
              />
              <span style={styles.value}>{currentStyle.shadowOffsetX ?? 0}</span>
            </div>
            <div style={styles.row}>
              <label style={styles.label}>Offset Y</label>
              <input
                type="range" min={-30} max={30} step={1}
                value={currentStyle.shadowOffsetY ?? 0}
                onChange={(e) => applyToSelected({ shadowOffsetY: parseFloat(e.target.value) })}
                style={styles.slider}
              />
              <span style={styles.value}>{currentStyle.shadowOffsetY ?? 0}</span>
            </div>
          </>
        )}

        {recentColors.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <label style={{ ...styles.label, fontSize: 9, color: '#6a6a8e', marginBottom: 3, display: 'block' }}>Recent Colors</label>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {recentColors.map((color, i) => (
                <button
                  key={`${color}-${i}`}
                  onClick={() => applyToSelected({ fillColor: color })}
                  onContextMenu={(e) => { e.preventDefault(); applyToSelected({ strokeColor: color }) }}
                  title={`${color}\nLeft-click → fill\nRight-click → stroke`}
                  style={{
                    width: 18, height: 18, borderRadius: 3, border: '1px solid #3a3a5e',
                    background: color, cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={styles.divider} />

      {/* ALIGNMENT & DISTRIBUTION */}
      {selectedShapeIds.length >= 2 && (
        <>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>ALIGN</div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {([
                ['⇤', 'Align Left', 'left'],
                ['⇔', 'Center H', 'centerH'],
                ['⇥', 'Align Right', 'right'],
                ['⤒', 'Align Top', 'top'],
                ['⇕', 'Center V', 'centerV'],
                ['⤓', 'Align Bottom', 'bottom'],
              ] as const).map(([icon, title, action]) => (
                <button
                  key={action}
                  onClick={() => handleAlign(action as any)}
                  style={styles.alignBtn}
                  title={title}
                >
                  {icon}
                </button>
              ))}
            </div>
            {selectedShapeIds.length >= 3 && (
              <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                <button onClick={() => handleDistribute('horizontal')} style={{ ...styles.alignBtn, flex: 1 }} title="Distribute Horizontally">
                  ⇿ Dist H
                </button>
                <button onClick={() => handleDistribute('vertical')} style={{ ...styles.alignBtn, flex: 1 }} title="Distribute Vertically">
                  ↕ Dist V
                </button>
              </div>
            )}
          </div>
          <div style={styles.divider} />
        </>
      )}

      {/* CANVAS & SNAPPING */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>CANVAS</div>
        <div style={styles.row}>
          <label style={styles.label}>BG Color</label>
          <input
            type="color"
            value={canvasBgColor}
            onChange={(e) => setCanvasBgColor(e.target.value)}
            style={{ width: 28, height: 28, flexShrink: 0 }}
          />
          <span style={styles.value}>{canvasBgColor}</span>
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Snap Grid</label>
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={(e) => setSnapToGrid(e.target.checked)}
            style={{ accentColor: '#6a6aff' }}
          />
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={gridSize}
            onChange={(e) => setGridSize(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ ...styles.numInput, width: 42 }}
            title="Grid size (px)"
          />
          <span style={styles.value}>px</span>
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Guides</label>
          <input
            type="checkbox"
            checked={showSmartGuides}
            onChange={(e) => setShowSmartGuides(e.target.checked)}
            style={{ accentColor: '#6a6aff' }}
          />
          <span style={{ fontSize: 10, color: '#6a6a8e' }}>Smart alignment guides</span>
        </div>
        <div style={styles.row}>
          <label style={styles.label}>Checker</label>
          <input
            type="checkbox"
            checked={showCheckerboard}
            onChange={(e) => setShowCheckerboard(e.target.checked)}
            style={{ accentColor: '#6a6aff' }}
          />
          <span style={{ fontSize: 10, color: '#6a6a8e' }}>Transparency checkerboard</span>
        </div>
      </div>

      <div style={styles.divider} />

      <div style={styles.section}>
        <div style={styles.sectionTitle}>STYLE PRESETS</div>
        <div style={styles.presetGrid}>
          {Object.entries(STYLE_PRESETS).map(([name, preset]) => (
            <button
              key={name}
              onClick={() => applyToSelected(preset)}
              style={{
                ...styles.presetBtn,
                background: preset.fillColor || 'transparent',
                border: `2px solid ${preset.strokeColor}`,
                opacity: preset.opacity,
              }}
              title={name}
            />
          ))}
        </div>
        <div style={styles.presetLabels}>
          {Object.keys(STYLE_PRESETS).map((name) => (
            <span key={name} style={styles.presetLabel}>{name}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 220,
    background: '#12121f',
    borderLeft: '1px solid #2a2a3e',
    padding: '8px 0',
    overflowY: 'auto',
  },
  section: { padding: '4px 12px' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#6a6a8e',
    letterSpacing: '0.1em',
    marginBottom: 8,
    padding: '4px 0',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  label: { fontSize: 11, color: '#8a8aae', width: 55, flexShrink: 0 },
  slider: { flex: 1, accentColor: '#6a6aff' },
  value: { fontSize: 10, color: '#6a6a8e', width: 30, textAlign: 'right' as const },
  numInput: {
    flex: 1,
    background: '#1a1a2e',
    border: '1px solid #2a2a3e',
    borderRadius: 4,
    color: '#c0c0e0',
    fontSize: 11,
    padding: '3px 6px',
    outline: 'none',
    width: 50,
  },
  divider: { height: 1, background: '#2a2a3e', margin: '8px 0' },
  presetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 6,
    marginBottom: 4,
  },
  presetBtn: {
    width: '100%',
    aspectRatio: '1',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'transform 0.15s',
  },
  presetLabels: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 6,
  },
  presetLabel: {
    fontSize: 8,
    color: '#5a5a7e',
    textAlign: 'center' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  alignBtn: {
    padding: '4px 6px',
    background: '#1a1a2e',
    border: '1px solid #2a2a3e',
    borderRadius: 4,
    color: '#c0c0e0',
    fontSize: 12,
    cursor: 'pointer',
    lineHeight: 1,
  },
}

