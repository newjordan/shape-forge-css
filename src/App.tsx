import React, { useState, useRef } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import PropertiesPanel from './components/PropertiesPanel'
import ExportPanel from './components/ExportPanel'
import ImageTraceModal from './components/ImageTraceModal'
import { useStore } from './store'
import { createPathsFromTrace, getProject, nextId } from './engine'
import type { ShapeItem, TraceResult, TraceOptions } from './types'

export default function App() {
  const [showExport, setShowExport] = useState(false)
  const [traceFile, setTraceFile] = useState<File | null>(null)
  const traceFileInputRef = useRef<HTMLInputElement>(null)
  const canUndo = useStore((s) => s.canUndo())
  const canRedo = useStore((s) => s.canRedo())
  const activeTool = useStore((s) => s.activeTool)
  const currentStyle = useStore((s) => s.currentStyle)

  const handleOpenTrace = () => {
    traceFileInputRef.current?.click()
  }

  const handleTraceFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setTraceFile(file)
    if (traceFileInputRef.current) traceFileInputRef.current.value = ''
  }

  const handleTraceAccept = (result: TraceResult, options: TraceOptions) => {
    const pathItem = createPathsFromTrace(result, currentStyle, options.simplifyTolerance, options.pathOffset, options.cornerAngle)
    if (pathItem) {
      const id = nextId()
      pathItem.data = { shapeId: id }
      console.log('[trace-accept] created item id:', pathItem.id, 'shapeId:', id,
        'type:', pathItem.className, 'bounds:', pathItem.bounds.width, 'x', pathItem.bounds.height,
        'pos:', pathItem.position.x, pathItem.position.y,
        'parent:', pathItem.parent?.name)
      const store = useStore.getState()
      const shapeItem: ShapeItem = {
        id,
        name: `trace ${store.shapes.length + 1}`,
        paperItemId: pathItem.id,
        style: { ...currentStyle },
        visible: true,
        locked: false,
      }
      store.addShape(shapeItem)
      store.setSelectedShapeIds([id])
      store.pushHistory({
        json: getProject().exportJSON(),
        shapes: useStore.getState().shapes,
        description: 'Image trace',
      })
    } else {
      console.warn('[trace-accept] createPathsFromTrace returned null!')
    }
    setTraceFile(null)
  }

  return (
    <div style={styles.app}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>◆</span>
          <span style={styles.logoText}>Shape Forge</span>
        </div>
        <div style={styles.topCenter}>
          <span style={styles.toolIndicator}>{activeTool.toUpperCase()}</span>
        </div>
        <div style={styles.topActions}>
          <button
            onClick={() => useStore.getState().undoAndRestore()}
            disabled={!canUndo}
            style={{ ...styles.topBtn, opacity: canUndo ? 1 : 0.3 }}
            title="Undo (Ctrl+Z)"
          >
            ↩
          </button>
          <button
            onClick={() => useStore.getState().redoAndRestore()}
            disabled={!canRedo}
            style={{ ...styles.topBtn, opacity: canRedo ? 1 : 0.3 }}
            title="Redo (Ctrl+Y)"
          >
            ↪
          </button>
          <button
            onClick={() => setShowExport(!showExport)}
            style={{
              ...styles.topBtn,
              background: showExport ? '#3a3a6e' : '#2a2a4e',
              padding: '4px 12px',
            }}
          >
            Export
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={styles.main}>
        <Toolbar onOpenTrace={handleOpenTrace} />
        <div style={styles.canvasArea}>
          <Canvas />
          {showExport && <ExportPanel />}
        </div>
        <PropertiesPanel />
      </div>

      {/* Hidden file input for trace import */}
      <input
        ref={traceFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={handleTraceFileSelected}
      />

      {/* Image Trace Modal */}
      {traceFile && (
        <ImageTraceModal
          file={traceFile}
          onAccept={handleTraceAccept}
          onCancel={() => setTraceFile(null)}
        />
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a0f',
  },
  topBar: {
    height: 40,
    background: '#12121f',
    borderBottom: '1px solid #2a2a3e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    flexShrink: 0,
  },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoIcon: { fontSize: 18, color: '#6a6aff' },
  logoText: { fontSize: 14, fontWeight: 700, color: '#e0e0f0', letterSpacing: '0.05em' },
  topCenter: { display: 'flex', alignItems: 'center' },
  toolIndicator: {
    fontSize: 10,
    color: '#6a6a8e',
    background: '#1a1a2e',
    padding: '3px 10px',
    borderRadius: 4,
    letterSpacing: '0.1em',
    fontWeight: 600,
  },
  topActions: { display: 'flex', alignItems: 'center', gap: 6 },
  topBtn: {
    padding: '4px 8px',
    background: '#2a2a4e',
    borderRadius: 4,
    fontSize: 13,
    border: '1px solid #3a3a5e',
    color: '#ccc',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  canvasArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
}

