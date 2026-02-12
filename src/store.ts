import { create } from 'zustand'
import type { ToolType, ShapeItem, ShapeStyle, HistoryEntry } from './types'
import { DEFAULT_STYLE } from './types'

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

