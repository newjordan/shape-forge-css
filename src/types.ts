export type ToolType =
  | 'select'
  | 'rectangle'
  | 'circle'
  | 'roundedRect'
  | 'polygon'
  | 'star'
  | 'pen'

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude'

export interface ShapeStyle {
  fillColor: string | null
  strokeColor: string
  strokeWidth: number
  opacity: number
}

export interface ShapeItem {
  id: string
  name: string
  paperItemId: number
  style: ShapeStyle
  visible: boolean
  locked: boolean
}

export interface HistoryEntry {
  json: string
  shapes: ShapeItem[]
  description: string
}

export const DEFAULT_STYLE: ShapeStyle = {
  fillColor: '#4a9eff',
  strokeColor: '#ffffff',
  strokeWidth: 0,
  opacity: 1,
}

// --- Image Trace types ---

export type TraceChannel = 'alpha' | 'luminance' | 'red' | 'green' | 'blue'

export interface TraceOptions {
  channel: TraceChannel
  threshold: number        // 0-255
  blurRadius: number       // 0-10 px gaussian blur
  simplifyTolerance: number // 0.5-20
  minArea: number          // minimum contour area in px² (scaled coords)
  pathOffset: number       // -50 to +50 px expand/contract contours
  invert: boolean          // swap inside/outside
  cornerAngle: number      // 0-180° corner detection threshold
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  channel: 'alpha',
  threshold: 128,
  blurRadius: 0,
  simplifyTolerance: 2.5,
  minArea: 20,
  pathOffset: 0,
  invert: false,
  cornerAngle: 160,
}

export interface ContourData {
  id: number
  points: { x: number; y: number }[]
  area: number
  bounds: { x: number; y: number; w: number; h: number }
  isHole: boolean          // determined by winding order (CW = hole)
  enabled: boolean         // for UI toggling
  pointCount: number
}

export interface TraceResult {
  contours: ContourData[]
  imageWidth: number
  imageHeight: number
  scaledWidth: number
  scaledHeight: number
  downscale: number
}

export const STYLE_PRESETS: Record<string, ShapeStyle> = {
  'Neon Blue': { fillColor: '#0044ff', strokeColor: '#00ccff', strokeWidth: 2, opacity: 0.9 },
  'Neon Pink': { fillColor: '#ff0066', strokeColor: '#ff66aa', strokeWidth: 2, opacity: 0.9 },
  'Hologram': { fillColor: '#00ffcc', strokeColor: '#00ff88', strokeWidth: 1, opacity: 0.6 },
  'Dark Metal': { fillColor: '#2a2a3e', strokeColor: '#5a5a7e', strokeWidth: 1, opacity: 1 },
  'Liquid Gold': { fillColor: '#cc8800', strokeColor: '#ffcc44', strokeWidth: 1, opacity: 0.95 },
  'Glass': { fillColor: '#ffffff', strokeColor: '#aaaacc', strokeWidth: 1, opacity: 0.15 },
  'Ember': { fillColor: '#ff3300', strokeColor: '#ff8844', strokeWidth: 1, opacity: 0.85 },
  'Void': { fillColor: '#0a0a1a', strokeColor: '#3a3a6e', strokeWidth: 2, opacity: 1 },
  'Outline': { fillColor: null, strokeColor: '#ffffff', strokeWidth: 2, opacity: 1 },
}

