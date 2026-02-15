import React, { useState, useRef } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import PropertiesPanel from './components/PropertiesPanel'
import ExportPanel from './components/ExportPanel'
import ImageTraceModal from './components/ImageTraceModal'
import { useStore } from './store'
import { createPathsFromTrace, getProject, nextId } from './engine'
import type { ShapeItem, TraceResult, TraceOptions } from './types'

/** Bottom status bar showing cursor position, selection info, and canvas dimensions. */
function StatusBar() {
  const cursorX = useStore((s) => s.cursorX)
  const cursorY = useStore((s) => s.cursorY)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)
  const shapes = useStore((s) => s.shapes)
  const zoomLevel = useStore((s) => s.zoomLevel)

  let info = ''
  if (selectedShapeIds.length === 0) {
    info = `${shapes.length} shape${shapes.length !== 1 ? 's' : ''} on canvas`
  } else if (selectedShapeIds.length === 1) {
    const shape = shapes.find((s) => s.id === selectedShapeIds[0])
    if (shape) info = `${shape.name} (${shape.primitiveType ?? 'path'})`
  } else {
    info = `${selectedShapeIds.length} shapes selected`
  }

  return (
    <div style={statusBarStyles.bar}>
      <span style={statusBarStyles.item}>X: {cursorX}  Y: {cursorY}</span>
      <span style={statusBarStyles.separator}>|</span>
      <span style={statusBarStyles.item}>{info}</span>
      <span style={{ flex: 1 }} />
      <span style={statusBarStyles.item}>{Math.round(zoomLevel * 100)}%</span>
    </div>
  )
}

/** Keyboard shortcuts help modal (press ? to toggle) */
function ShortcutsHelp() {
  const show = useStore((s) => s.showShortcutsHelp)
  if (!show) return null
  const close = () => useStore.getState().setShowShortcutsHelp(false)

  const sections: { title: string; items: [string, string][] }[] = [
    {
      title: 'Tools',
      items: [
        ['V', 'Select tool'], ['R', 'Rectangle'], ['O', 'Ellipse/Circle'],
        ['U', 'Rounded Rect'], ['Y', 'Polygon'], ['L', 'Line'],
        ['N', 'Freehand'], ['P', 'Pen tool'], ['T', 'Text tool'],
        ['I', 'Eyedropper'], ['M', 'Measure distance'],
      ],
    },
    {
      title: 'Edit',
      items: [
        ['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z', 'Redo'], ['Ctrl+C', 'Copy'], ['Ctrl+V', 'Paste'],
        ['Ctrl+X', 'Cut'], ['Ctrl+D', 'Duplicate'], ['Ctrl+A', 'Select All'],
        ['Delete', 'Delete selected'], ['Escape', 'Deselect / Exit node edit'],
      ],
    },
    {
      title: 'Transform',
      items: [
        ['Arrow keys', 'Nudge 1px'], ['Shift+Arrow', 'Nudge 10px'],
        ['Ctrl+]', 'Bring forward'], ['Ctrl+[', 'Send backward'],
        ['Ctrl+G', 'Group'], ['Ctrl+Shift+G', 'Ungroup'],
        ['Alt+Drag', 'Duplicate & move'],
        ['Drag rotate handle', 'Rotate selection'], ['Shift+Rotate', 'Snap to 15°'],
        ['Drag resize handle', 'Resize selection'], ['Shift+Resize', 'Constrain proportions'],
      ],
    },
    {
      title: 'Canvas',
      items: [
        ['Space+Drag', 'Pan canvas'], ['Mouse Wheel', 'Zoom to cursor'],
        ['Ctrl+0', 'Fit to canvas'], ['Ctrl+1', 'Zoom 100%'],
        ['Ctrl+=', 'Zoom in'], ['Ctrl+-', 'Zoom out'],
        ['F', 'Focus / zoom to selection'], ['Home', 'Reset view (0,0 @ 100%)'],
        ['?', 'Toggle this help'],
      ],
    },
    {
      title: 'Drawing',
      items: [
        ['Shift+Drag', 'Constrain to square/circle'], ['Double-click', 'Edit nodes'],
        ['Alt+Drag handle', 'Break handle symmetry'], ['Ctrl+V SVG', 'Import SVG from clipboard'],
      ],
    },
  ]

  return (
    <div style={helpStyles.overlay} onClick={close}>
      <div style={helpStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={helpStyles.header}>
          <span style={helpStyles.title}>Keyboard Shortcuts</span>
          <button style={helpStyles.closeBtn} onClick={close}>✕</button>
        </div>
        <div style={helpStyles.body}>
          {sections.map((sec) => (
            <div key={sec.title} style={helpStyles.section}>
              <div style={helpStyles.secTitle}>{sec.title}</div>
              {sec.items.map(([key, desc]) => (
                <div key={key} style={helpStyles.row}>
                  <kbd style={helpStyles.kbd}>{key}</kbd>
                  <span style={helpStyles.desc}>{desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const helpStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 9999,
  },
  modal: {
    background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 10,
    width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 16px', borderBottom: '1px solid #2a2a3e',
  },
  title: { fontSize: 14, fontWeight: 700, color: '#e0e0f0', letterSpacing: '0.05em' },
  closeBtn: {
    background: 'none', border: 'none', color: '#6a6a8e', fontSize: 16, cursor: 'pointer',
  },
  body: {
    padding: 16, overflowY: 'auto' as const,
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
  },
  section: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  secTitle: {
    fontSize: 10, fontWeight: 700, color: '#6a6aff', letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, marginBottom: 4,
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  kbd: {
    background: '#0a0a14', border: '1px solid #3a3a5e', borderRadius: 3,
    padding: '2px 6px', fontSize: 10, fontFamily: 'monospace', color: '#c0c0e0',
    minWidth: 50, textAlign: 'center' as const,
  },
  desc: { fontSize: 11, color: '#8a8aae' },
}

const statusBarStyles: Record<string, React.CSSProperties> = {
  bar: {
    height: 24,
    background: '#12121f',
    borderTop: '1px solid #2a2a3e',
    display: 'flex',
    alignItems: 'center',
    padding: '0 10px',
    flexShrink: 0,
    gap: 8,
  },
  item: {
    fontSize: 10,
    color: '#6a6a8e',
    fontFamily: 'monospace',
    letterSpacing: '0.04em',
  },
  separator: {
    fontSize: 10,
    color: '#2a2a3e',
  },
}

export default function App() {
  const [showExport, setShowExport] = useState(false)
  const [traceFile, setTraceFile] = useState<File | null>(null)
  const traceFileInputRef = useRef<HTMLInputElement>(null)
  const canUndo = useStore((s) => s.canUndo())
  const canRedo = useStore((s) => s.canRedo())
  const activeTool = useStore((s) => s.activeTool)
  const currentStyle = useStore((s) => s.currentStyle)
  const zoomLevel = useStore((s) => s.zoomLevel)

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
          <span style={{ ...styles.toolIndicator, marginLeft: 8 }}>
            {Math.round(zoomLevel * 100)}%
          </span>
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
          <button
            onClick={() => useStore.getState().setShowShortcutsHelp(true)}
            style={{ ...styles.topBtn, fontSize: 12, fontWeight: 700 }}
            title="Keyboard Shortcuts (?)"
          >
            ?
          </button>
        </div>
      </div>

      {/* Main area */}
      <div style={styles.main}>
        <Toolbar onOpenTrace={handleOpenTrace} />
        <div style={styles.canvasArea}>
          <Canvas />
          {showExport && <ExportPanel />}
          <StatusBar />
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

      {/* Shortcuts Help Modal */}
      <ShortcutsHelp />
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

