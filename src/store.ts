import { create } from 'zustand'
import type { ToolType, ShapeItem, ShapeStyle, HistoryEntry } from './types'
import { DEFAULT_STYLE } from './types'

interface ClipboardEntry {
  shapes: ShapeItem[]
  paperJson: string // serialized Paper.js items
}

interface AppState {
  // Tool
  activeTool: ToolType
  setActiveTool: (tool: ToolType) => void

  // Shapes
  shapes: ShapeItem[]
  selectedShapeIds: string[]
  setShapes: (shapes: ShapeItem[]) => void
  addShape: (shape: ShapeItem) => void
  removeShape: (id: string) => void
  updateShape: (id: string, updates: Partial<ShapeItem>) => void
  setSelectedShapeIds: (ids: string[]) => void

  // Layer ordering
  bringForward: (id: string) => void
  sendBackward: (id: string) => void
  bringToFront: (id: string) => void
  sendToBack: (id: string) => void
  moveShapeToIndex: (id: string, newIndex: number) => void

  // Clipboard
  clipboard: ClipboardEntry | null
  setClipboard: (entry: ClipboardEntry | null) => void
  pasteCount: number
  incrementPasteCount: () => void
  resetPasteCount: () => void

  // Style
  currentStyle: ShapeStyle
  setCurrentStyle: (style: Partial<ShapeStyle>) => void

  // History
  history: HistoryEntry[]
  historyIndex: number
  pushHistory: (entry: HistoryEntry) => void
  undo: () => HistoryEntry | null
  redo: () => HistoryEntry | null
  canUndo: () => boolean
  canRedo: () => boolean

  // Pen tool state
  penPath: number | null
  setPenPath: (id: number | null) => void

  // Node edit mode
  editMode: 'shape' | 'node'
  editingShapeId: string | null
  enterNodeEdit: (shapeId: string) => void
  exitNodeEdit: () => void

  // Canvas navigation state
  isPanning: boolean
  setIsPanning: (v: boolean) => void
  spaceHeld: boolean
  setSpaceHeld: (v: boolean) => void

  // Zoom level (for UI display)
  zoomLevel: number
  setZoomLevel: (z: number) => void

  // Canvas background color
  canvasBgColor: string
  setCanvasBgColor: (c: string) => void

  // Cursor position (for status bar)
  cursorX: number
  cursorY: number
  setCursorPosition: (x: number, y: number) => void

  // Checkerboard transparency background
  showCheckerboard: boolean
  setShowCheckerboard: (v: boolean) => void

  // Snap-to-grid & smart guides
  snapToGrid: boolean
  setSnapToGrid: (v: boolean) => void
  gridSize: number
  setGridSize: (v: number) => void
  showSmartGuides: boolean
  setShowSmartGuides: (v: boolean) => void

  // Recent colors palette
  recentColors: string[]
  addRecentColor: (color: string) => void

  // Reference image (background tracing layer)
  refImageUrl: string | null
  refImageOpacity: number
  refImageVisible: boolean
  setRefImageUrl: (url: string | null) => void
  setRefImageOpacity: (v: number) => void
  setRefImageVisible: (v: boolean) => void

  // Shortcuts help overlay
  showShortcutsHelp: boolean
  setShowShortcutsHelp: (v: boolean) => void

  // Restore callback (set by Canvas so App can trigger undo/redo with Paper.js restore)
  _restoreCallback: ((entry: HistoryEntry) => void) | null
  setRestoreCallback: (cb: ((entry: HistoryEntry) => void) | null) => void
  undoAndRestore: () => void
  redoAndRestore: () => void
}

export const useStore = create<AppState>((set, get) => ({
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),

  shapes: [],
  selectedShapeIds: [],
  setShapes: (shapes) => set({ shapes }),
  addShape: (shape) => set((s) => ({ shapes: [...s.shapes, shape] })),
  removeShape: (id) => set((s) => ({
    shapes: s.shapes.filter((sh) => sh.id !== id),
    selectedShapeIds: s.selectedShapeIds.filter((sid) => sid !== id),
  })),
  updateShape: (id, updates) => set((s) => ({
    shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, ...updates } : sh)),
  })),
  setSelectedShapeIds: (ids) => set({ selectedShapeIds: ids }),

  // Layer ordering
  bringForward: (id) => set((s) => {
    const idx = s.shapes.findIndex((sh) => sh.id === id)
    if (idx < 0 || idx >= s.shapes.length - 1) return s
    const arr = [...s.shapes]
    ;[arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]
    return { shapes: arr }
  }),
  sendBackward: (id) => set((s) => {
    const idx = s.shapes.findIndex((sh) => sh.id === id)
    if (idx <= 0) return s
    const arr = [...s.shapes]
    ;[arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]]
    return { shapes: arr }
  }),
  bringToFront: (id) => set((s) => {
    const idx = s.shapes.findIndex((sh) => sh.id === id)
    if (idx < 0 || idx >= s.shapes.length - 1) return s
    const arr = [...s.shapes]
    const [item] = arr.splice(idx, 1)
    arr.push(item)
    return { shapes: arr }
  }),
  sendToBack: (id) => set((s) => {
    const idx = s.shapes.findIndex((sh) => sh.id === id)
    if (idx <= 0) return s
    const arr = [...s.shapes]
    const [item] = arr.splice(idx, 1)
    arr.unshift(item)
    return { shapes: arr }
  }),
  moveShapeToIndex: (id, newIndex) => set((s) => {
    const idx = s.shapes.findIndex((sh) => sh.id === id)
    if (idx < 0 || idx === newIndex) return s
    const arr = [...s.shapes]
    const [item] = arr.splice(idx, 1)
    const clampedIndex = Math.max(0, Math.min(newIndex, arr.length))
    arr.splice(clampedIndex, 0, item)
    return { shapes: arr }
  }),

  // Clipboard
  clipboard: null,
  setClipboard: (entry) => set({ clipboard: entry, pasteCount: 0 }),
  pasteCount: 0,
  incrementPasteCount: () => set((s) => ({ pasteCount: s.pasteCount + 1 })),
  resetPasteCount: () => set({ pasteCount: 0 }),

  currentStyle: { ...DEFAULT_STYLE },
  setCurrentStyle: (style) => set((s) => ({
    currentStyle: { ...s.currentStyle, ...style },
  })),

  history: [],
  historyIndex: -1,
  pushHistory: (entry) => set((s) => {
    const newHistory = s.history.slice(0, s.historyIndex + 1)
    newHistory.push(entry)
    if (newHistory.length > 50) newHistory.shift()
    return { history: newHistory, historyIndex: newHistory.length - 1 }
  }),
  undo: () => {
    const s = get()
    if (s.historyIndex <= 0) return null
    const newIndex = s.historyIndex - 1
    set({ historyIndex: newIndex })
    return s.history[newIndex]
  },
  redo: () => {
    const s = get()
    if (s.historyIndex >= s.history.length - 1) return null
    const newIndex = s.historyIndex + 1
    set({ historyIndex: newIndex })
    return s.history[newIndex]
  },
  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,

  penPath: null,
  setPenPath: (id) => set({ penPath: id }),

  editMode: 'shape',
  editingShapeId: null,
  enterNodeEdit: (shapeId) => set({ editMode: 'node', editingShapeId: shapeId, selectedShapeIds: [shapeId] }),
  exitNodeEdit: () => set({ editMode: 'shape', editingShapeId: null }),

  // Canvas navigation state
  isPanning: false,
  setIsPanning: (v) => set({ isPanning: v }),
  spaceHeld: false,
  setSpaceHeld: (v) => set({ spaceHeld: v }),

  // Zoom level
  zoomLevel: 1,
  setZoomLevel: (z) => set({ zoomLevel: z }),

  // Canvas background color
  canvasBgColor: '#0d0d1a',
  setCanvasBgColor: (c) => set({ canvasBgColor: c }),

  // Cursor position
  cursorX: 0,
  cursorY: 0,
  setCursorPosition: (x, y) => set({ cursorX: x, cursorY: y }),

  // Checkerboard transparency background
  showCheckerboard: false,
  setShowCheckerboard: (v) => set({ showCheckerboard: v }),

  // Snap-to-grid & smart guides
  snapToGrid: false,
  setSnapToGrid: (v) => set({ snapToGrid: v }),
  gridSize: 10,
  setGridSize: (v) => set({ gridSize: v }),
  showSmartGuides: true,
  setShowSmartGuides: (v) => set({ showSmartGuides: v }),

  // Recent colors palette
  recentColors: [],
  addRecentColor: (color) => set((s) => {
    const lc = color.toLowerCase()
    const filtered = s.recentColors.filter((c) => c.toLowerCase() !== lc)
    return { recentColors: [color, ...filtered].slice(0, 12) }
  }),

  // Reference image
  refImageUrl: null,
  refImageOpacity: 0.3,
  refImageVisible: true,
  setRefImageUrl: (url) => set({ refImageUrl: url }),
  setRefImageOpacity: (v) => set({ refImageOpacity: v }),
  setRefImageVisible: (v) => set({ refImageVisible: v }),

  // Shortcuts help
  showShortcutsHelp: false,
  setShowShortcutsHelp: (v) => set({ showShortcutsHelp: v }),

  _restoreCallback: null,
  setRestoreCallback: (cb) => set({ _restoreCallback: cb }),
  undoAndRestore: () => {
    const entry = get().undo()
    if (entry && get()._restoreCallback) {
      get()._restoreCallback!(entry)
    }
  },
  redoAndRestore: () => {
    const entry = get().redo()
    if (entry && get()._restoreCallback) {
      get()._restoreCallback!(entry)
    }
  },
}))

