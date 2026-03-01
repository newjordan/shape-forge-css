import React, { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import type { ToolType, BooleanOp } from '../types'
import { getDrawLayer, batchBooleanOp, findProximityClusters, nextId, exportHistoryJSON } from '../engine'
import paper from 'paper'
import type { ShapeItem } from '../types'

const tools: { id: ToolType; label: string; icon: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', icon: '⇱', shortcut: 'V' },
  { id: 'rectangle', label: 'Rectangle', icon: '▬', shortcut: 'R' },
  { id: 'circle', label: 'Circle', icon: '●', shortcut: 'O' },
  { id: 'roundedRect', label: 'Rounded Rect', icon: '▢', shortcut: '' },
  { id: 'polygon', label: 'Polygon', icon: '⬡', shortcut: '' },
  { id: 'star', label: 'Star', icon: '★', shortcut: '' },
  { id: 'line', label: 'Line', icon: '╲', shortcut: 'L' },
  { id: 'freehand', label: 'Freehand', icon: '〰', shortcut: 'N' },
  { id: 'pen', label: 'Pen Tool', icon: '✒', shortcut: 'P' },
  { id: 'text', label: 'Text', icon: 'T', shortcut: 'T' },
  { id: 'eyedropper', label: 'Eyedropper', icon: '💧', shortcut: 'I' },
  { id: 'measure', label: 'Measure', icon: '📏', shortcut: 'M' },
]

const boolOps: { id: BooleanOp; label: string; icon: string }[] = [
  { id: 'unite', label: 'Union', icon: '⊕' },
  { id: 'subtract', label: 'Subtract', icon: '⊖' },
  { id: 'intersect', label: 'Intersect', icon: '⊗' },
  { id: 'exclude', label: 'Exclude', icon: '⊘' },
]

/** Individual layer row with visibility, lock, rename, delete, and drag-to-reorder */
function LayerItem({ shape, isSelected, selectedShapeIds, dragOverId, dragPosition, onDragStart: onDragStartProp, onDragOver: onDragOverProp, onDrop: onDropProp, onDragEnd: onDragEndProp }: {
  shape: ShapeItem; isSelected: boolean; selectedShapeIds: string[]
  dragOverId: string | null; dragPosition: 'above' | 'below' | null
  onDragStart: (id: string) => void; onDragOver: (id: string, pos: 'above' | 'below') => void
  onDrop: () => void; onDragEnd: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(shape.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

  const commitRename = () => {
    const trimmed = renameVal.trim()
    if (trimmed && trimmed !== shape.name) {
      useStore.getState().updateShape(shape.id, { name: trimmed })
    }
    setRenaming(false)
  }

  const toggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newVis = !shape.visible
    useStore.getState().updateShape(shape.id, { visible: newVis })
    const drawLayer = getDrawLayer()
    const item = drawLayer.children.find((c) => c.data?.shapeId === shape.id)
    if (item) item.visible = newVis
  }

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation()
    useStore.getState().updateShape(shape.id, { locked: !shape.locked })
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    const drawLayer = getDrawLayer()
    const item = drawLayer.children.find((c) => c.data?.shapeId === shape.id)
    if (item) item.remove()
    useStore.getState().removeShape(shape.id)
    useStore.getState().pushHistory({
			json: exportHistoryJSON(),
      shapes: useStore.getState().shapes,
      description: `Delete ${shape.name}`,
    })
  }

  const handleClick = () => {
    const store = useStore.getState()
    const current = store.selectedShapeIds
    if (current.includes(shape.id)) {
      store.setSelectedShapeIds(current.filter((id) => id !== shape.id))
    } else {
      store.setSelectedShapeIds([...current, shape.id])
    }
  }

  const isDropTarget = dragOverId === shape.id
  const dropBorderStyle: React.CSSProperties = isDropTarget ? {
    borderTop: dragPosition === 'above' ? '2px solid #6a6aff' : undefined,
    borderBottom: dragPosition === 'below' ? '2px solid #6a6aff' : undefined,
  } : {}

  return (
    <div
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStartProp(shape.id)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        onDragOverProp(shape.id, e.clientY < midY ? 'above' : 'below')
      }}
      onDrop={(e) => { e.preventDefault(); onDropProp() }}
      onDragEnd={onDragEndProp}
      style={{
        ...styles.layerItem,
        background: isSelected ? '#2a2a5e' : 'transparent',
        borderColor: isSelected ? '#4a4aff' : 'transparent',
        opacity: shape.visible ? 1 : 0.45,
        ...dropBorderStyle,
      }}
      onClick={handleClick}
    >
      {/* Visibility eye */}
      <button onClick={toggleVisibility} style={styles.layerIconBtn} title={shape.visible ? 'Hide' : 'Show'}>
        {shape.visible ? '👁' : '👁‍🗨'}
      </button>
      {/* Lock */}
      <button onClick={toggleLock} style={{ ...styles.layerIconBtn, color: shape.locked ? '#ff8844' : '#5a5a7e' }} title={shape.locked ? 'Unlock' : 'Lock'}>
        {shape.locked ? '🔒' : '🔓'}
      </button>
      {/* Color swatch */}
      <span style={{ width: 10, height: 10, borderRadius: 2, background: shape.style.fillColor || 'transparent', border: shape.style.fillColor ? 'none' : '1px solid #5a5a7e', display: 'inline-block', marginRight: 4, flexShrink: 0 }} />
      {/* Name (double-click to rename) */}
      {renaming ? (
        <input
          ref={inputRef}
          value={renameVal}
          onChange={(e) => setRenameVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') { setRenameVal(shape.name); setRenaming(false) }
          }}
          style={styles.renameInput}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span style={styles.layerName} onDoubleClick={(e) => { e.stopPropagation(); setRenameVal(shape.name); setRenaming(true) }}>
          {shape.name}
        </span>
      )}
      {/* Delete button */}
      <button onClick={handleDelete} style={{ ...styles.layerIconBtn, marginLeft: 'auto', color: '#ff5555', fontSize: 11 }} title="Delete">
        ✕
      </button>
    </div>
  )
}

interface ToolbarProps {
  onOpenTrace: () => void
}

export default function Toolbar({ onOpenTrace }: ToolbarProps) {
  const activeTool = useStore((s) => s.activeTool)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)
  const shapes = useStore((s) => s.shapes)
  const currentStyle = useStore((s) => s.currentStyle)
  const [proximityThreshold, setProximityThreshold] = useState(30)

  // Drag-to-reorder state
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragPosition, setDragPosition] = useState<'above' | 'below' | null>(null)

  const handleLayerDragStart = (id: string) => { setDragSourceId(id) }
  const handleLayerDragOver = (id: string, pos: 'above' | 'below') => { setDragOverId(id); setDragPosition(pos) }
  const handleLayerDragEnd = () => { setDragSourceId(null); setDragOverId(null); setDragPosition(null) }
  const handleLayerDrop = () => {
    if (dragSourceId && dragOverId && dragSourceId !== dragOverId) {
      const store = useStore.getState()
      const targetIdx = store.shapes.findIndex((s) => s.id === dragOverId)
      if (targetIdx >= 0) {
        const newIdx = dragPosition === 'below' ? targetIdx + 1 : targetIdx
        store.moveShapeToIndex(dragSourceId, newIdx)
        // Sync Paper.js layer order
        const drawLayer = getDrawLayer()
        const updatedShapes = useStore.getState().shapes
        for (const shape of updatedShapes) {
          const item = drawLayer.children.find((c) => c.data?.shapeId === shape.id)
          if (item) drawLayer.addChild(item)
        }
				store.pushHistory({ json: exportHistoryJSON(), shapes: useStore.getState().shapes, description: 'Reorder layers' })
      }
    }
    handleLayerDragEnd()
  }

  const canBoolean = selectedShapeIds.length >= 2

  // Batch boolean on all selected shapes
  const handleBoolean = (op: BooleanOp) => {
    if (!canBoolean) return

    // Gather all selected paper items from draw layer
    const drawLayer = getDrawLayer()
    const paths: paper.PathItem[] = []
    for (const sid of selectedShapeIds) {
      const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
      if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
        paths.push(item as paper.PathItem)
      }
    }
    if (paths.length < 2) return

    const result = batchBooleanOp(op, paths, currentStyle)
    if (!result) return

    const newId = nextId()
    result.data = { shapeId: newId }

    const store = useStore.getState()
    for (const sid of selectedShapeIds) store.removeShape(sid)
    const shapeItem: ShapeItem = {
      id: newId,
      name: `${op} (${paths.length})`,
      paperItemId: result.id,
      style: { ...currentStyle },
      visible: true,
      locked: false,
    }
    store.addShape(shapeItem)
    store.setSelectedShapeIds([newId])
		store.pushHistory({ json: exportHistoryJSON(), shapes: useStore.getState().shapes, description: `Batch ${op} (${paths.length})` })
  }

  // Auto-merge nearby shapes by proximity clustering
  const handleMergeNearby = (op: BooleanOp) => {
    const allIds = shapes.map((s) => s.id)
    const clusters = findProximityClusters(allIds, proximityThreshold)
    if (clusters.length === 0) return

    const store = useStore.getState()
    const drawLayer = getDrawLayer()
    for (const cluster of clusters) {
      const paths: paper.PathItem[] = []
      for (const sid of cluster) {
        const item = drawLayer.children.find((c) => c.data?.shapeId === sid)
        if (item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
          paths.push(item as paper.PathItem)
        }
      }
      if (paths.length < 2) continue

      const result = batchBooleanOp(op, paths, currentStyle)
      if (!result) continue

      const newId = nextId()
      result.data = { shapeId: newId }
      for (const sid of cluster) store.removeShape(sid)
      store.addShape({
        id: newId,
        name: `${op} cluster (${paths.length})`,
        paperItemId: result.id,
        style: { ...currentStyle },
        visible: true,
        locked: false,
      })
    }

    store.setSelectedShapeIds([])
		store.pushHistory({ json: exportHistoryJSON(), shapes: useStore.getState().shapes, description: `Merge nearby (${clusters.length} clusters)` })
  }

  return (
    <div style={styles.toolbar}>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>TOOLS</div>
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTool(t.id)}
            style={{
              ...styles.toolBtn,
              background: activeTool === t.id ? '#3a3a6e' : 'transparent',
              borderColor: activeTool === t.id ? '#6a6aff' : 'transparent',
            }}
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
          >
            <span style={styles.toolIcon}>{t.icon}</span>
            <span style={styles.toolLabel}>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={styles.divider} />

      <div style={styles.section}>
        <div style={styles.sectionTitle}>BOOLEAN</div>
        {boolOps.map((b) => (
          <button
            key={b.id}
            onClick={() => handleBoolean(b.id)}
            disabled={!canBoolean}
            style={{
              ...styles.toolBtn,
              opacity: canBoolean ? 1 : 0.35,
              cursor: canBoolean ? 'pointer' : 'not-allowed',
            }}
            title={`${b.label} (select 2+ shapes)`}
          >
            <span style={styles.toolIcon}>{b.icon}</span>
            <span style={styles.toolLabel}>{b.label}</span>
          </button>
        ))}
        {!canBoolean && (
          <div style={styles.hint}>Select 2+ shapes to use boolean ops</div>
        )}
        {canBoolean && (
          <div style={styles.hint}>{selectedShapeIds.length} shapes selected — pick an op</div>
        )}
      </div>

      <div style={styles.divider} />

      <div style={styles.section}>
        <div style={styles.sectionTitle}>MERGE NEARBY</div>
        <div style={styles.hint}>Auto-cluster shapes by proximity &amp; merge each group</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <label style={{ fontSize: 10, color: '#8a8aae', whiteSpace: 'nowrap' }}>Gap</label>
          <input
            type="range"
            min={0}
            max={150}
            value={proximityThreshold}
            onChange={(e) => setProximityThreshold(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#6a6aff', height: 4 }}
          />
          <span style={{ fontSize: 10, color: '#8a8aae', minWidth: 30, textAlign: 'right' }}>{proximityThreshold}px</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          {boolOps.map((b) => (
            <button
              key={b.id}
              onClick={() => handleMergeNearby(b.id)}
              disabled={shapes.length < 2}
              style={{
                ...styles.mergeBtn,
                opacity: shapes.length < 2 ? 0.35 : 1,
                cursor: shapes.length < 2 ? 'not-allowed' : 'pointer',
              }}
              title={`Merge nearby clusters with ${b.label}`}
            >
              <span>{b.icon}</span> {b.label}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.divider} />

      <div style={styles.section}>
        <div style={styles.sectionTitle}>IMAGE TRACE</div>
        <div style={styles.hint}>Import a PNG — trace outlines to vector paths with full controls</div>
        <button
          onClick={onOpenTrace}
          style={{
            ...styles.mergeBtn,
            width: '100%',
            marginTop: 6,
          }}
        >
          📷 Import &amp; Trace PNG
        </button>
      </div>

      <div style={styles.divider} />

      <div style={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={styles.sectionTitle}>LAYERS ({shapes.length})</div>
          {selectedShapeIds.length > 0 && (
            <button
              onClick={() => useStore.getState().setSelectedShapeIds([])}
              style={{ fontSize: 9, color: '#6a6a8e', padding: '2px 6px', background: '#1a1a2e', borderRadius: 3, border: '1px solid #2a2a3e' }}
              title="Clear selection"
            >
              Clear
            </button>
          )}
        </div>
        {selectedShapeIds.length > 0 && (
          <div style={styles.selectionInfo}>
            {selectedShapeIds.length} selected
            {selectedShapeIds.length >= 2 && ' — ready for boolean'}
          </div>
        )}
        <div style={styles.layerList}>
          {shapes.map((s) => (
            <LayerItem
              key={s.id}
              shape={s}
              isSelected={selectedShapeIds.includes(s.id)}
              selectedShapeIds={selectedShapeIds}
              dragOverId={dragOverId}
              dragPosition={dragPosition}
              onDragStart={handleLayerDragStart}
              onDragOver={handleLayerDragOver}
              onDrop={handleLayerDrop}
              onDragEnd={handleLayerDragEnd}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    width: 200,
    background: '#12121f',
    borderRight: '1px solid #2a2a3e',
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 0',
    overflowY: 'auto',
  },
  section: { padding: '4px 8px' },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: '#6a6a8e',
    letterSpacing: '0.1em',
    marginBottom: 6,
    padding: '4px 0',
  },
  toolBtn: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid transparent',
    marginBottom: 2,
    transition: 'all 0.15s',
  },
  toolIcon: { fontSize: 16, width: 24, textAlign: 'center' as const },
  toolLabel: { marginLeft: 8, fontSize: 12 },
  divider: { height: 1, background: '#2a2a3e', margin: '8px 0' },
  hint: { fontSize: 10, color: '#5a5a7e', padding: '4px 0', fontStyle: 'italic' },
  selectionInfo: {
    fontSize: 10,
    color: '#6a6aff',
    padding: '2px 0 6px 0',
    fontWeight: 600,
  },
  layerList: { maxHeight: 300, overflowY: 'auto' as const },
  layerItem: {
    padding: '3px 4px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    marginBottom: 1,
    border: '1px solid transparent',
    transition: 'all 0.1s',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    width: '100%',
    gap: 0,
  },
  checkbox: {
    width: 14,
    height: 14,
    marginRight: 6,
    accentColor: '#6a6aff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  layerName: {
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  mergeBtn: {
    padding: '5px 6px',
    borderRadius: 5,
    border: '1px solid #2a2a3e',
    background: '#1a1a2e',
    color: '#c0c0e0',
    fontSize: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transition: 'all 0.15s',
  },
  layerIconBtn: {
    background: 'none',
    border: 'none',
    padding: '0 2px',
    fontSize: 12,
    cursor: 'pointer',
    color: '#5a5a7e',
    lineHeight: 1,
    flexShrink: 0,
  },
  renameInput: {
    background: '#1a1a2e',
    border: '1px solid #6a6aff',
    borderRadius: 3,
    color: '#e0e0e0',
    padding: '1px 4px',
    fontSize: 11,
    outline: 'none',
    flex: 1,
    minWidth: 0,
  },
}

