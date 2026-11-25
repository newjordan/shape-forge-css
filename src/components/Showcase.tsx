import React, { useLayoutEffect, useState } from 'react'
import { fitItemClipPath, getDrawLayer } from '../engine'
import { useStore } from '../store'
import type { FittedClipPath } from '../engine'

interface ShapePreview extends FittedClipPath {
  id: string
  name: string
  fill: string
}

const STEPS = [
  'Edit the sample, or draw with the tools on the left.',
  'Select a shape. Its CSS clip-path updates below.',
  'Copy the rule, or open Export for SVG and PNG.',
]

function readPreviews(): ShapePreview[] {
  try {
    const layer = getDrawLayer()
    const shapes = useStore.getState().shapes
    const previews: ShapePreview[] = []
    for (const shape of shapes) {
      const item = layer.children.find((child) => child.data?.shapeId === shape.id)
      if (!item) continue
      const fitted = fitItemClipPath(item, 72)
      if (!fitted) continue
      previews.push({
        ...fitted,
        id: shape.id,
        name: shape.name,
        fill: shape.style.fillColor || shape.style.strokeColor || '#4a9eff',
      })
    }
    return previews
  } catch {
    return []
  }
}

function cssRule(preview: ShapePreview): string {
  return [
    `.${preview.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'shape'} {`,
    `  width: ${preview.width}px;`,
    `  height: ${preview.height}px;`,
    `  background: ${preview.fill};`,
    `  clip-path: path('${preview.cssPath}');`,
    '}',
  ].join('\n')
}

/** Guide docked on the canvas. The chips are real clip-path output from the current shapes. */
export default function Showcase({ lift = false }: { lift?: boolean }) {
  const shapes = useStore((s) => s.shapes)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)
  const demoApi = useStore((s) => s.demoApi)
  const [previews, setPreviews] = useState<ShapePreview[]>([])
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  useLayoutEffect(() => {
    setPreviews(readPreviews())
  }, [shapes])

  const active =
    previews.find((preview) => selectedShapeIds.includes(preview.id)) ??
    previews.find((preview) => preview.name === 'Mark') ??
    previews[0]

  const snippet = active ? cssRule(active) : ''

  const copyCss = async () => {
    if (!snippet) return
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <aside
      style={{ ...styles.panel, bottom: lift ? 220 : 36 }}
      aria-label="Live demo"
    >
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Live demo</div>
          <h2 style={styles.title}>Draw a shape. Ship it as CSS.</h2>
        </div>
        <button
          type="button"
          style={styles.close}
          onClick={() => useStore.getState().setShowShowcase(false)}
          aria-label="Hide demo guide"
        >
          ✕
        </button>
      </div>

      <ol style={styles.steps}>
        {STEPS.map((step, index) => (
          <li key={step} style={styles.step}>
            <span style={styles.stepNo}>{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {previews.length > 0 && active ? (
        <>
          <div style={styles.chipRow}>
            {previews.map((preview) => {
              const selected = preview.id === active.id
              return (
                <button
                  key={preview.id}
                  type="button"
                  aria-label={preview.name}
                  style={{
                    ...styles.chip,
                    borderColor: selected ? '#6a6aff' : '#2a2a44',
                    background: selected ? '#1a1a36' : '#0c0c18',
                  }}
                  onClick={() => useStore.getState().setSelectedShapeIds([preview.id])}
                  title={`Select ${preview.name}`}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: preview.width,
                      height: preview.height,
                      flexShrink: 0,
                      background: preview.fill,
                      clipPath: `path('${preview.cssPath}')`,
                      display: 'block',
                    }}
                  />
                  <span style={{ ...styles.chipName, color: selected ? '#e4e4ff' : '#8a8aae' }}>
                    {preview.name}
                  </span>
                </button>
              )
            })}
          </div>
          <pre style={styles.code}>{snippet}</pre>
        </>
      ) : (
        <p style={styles.empty}>
          The canvas is empty. Reset the sample, or draw a shape to generate a clip-path.
        </p>
      )}

      <div style={styles.actions}>
        <button type="button" style={styles.primary} onClick={copyCss} disabled={!snippet}>
          {copied ? 'Copied' : copyError ? 'Copy failed' : 'Copy CSS'}
        </button>
        <button
          type="button"
          style={styles.secondary}
          onClick={() => demoApi?.loadSample()}
          disabled={!demoApi}
        >
          Reset sample
        </button>
        <button
          type="button"
          style={styles.secondary}
          onClick={() => demoApi?.clearCanvas()}
          disabled={!demoApi}
        >
          Clear canvas
        </button>
      </div>
      <p style={styles.hint}>V select · R rectangle · O ellipse · ? shortcuts</p>
    </aside>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    left: 12,
    bottom: 36,
    zIndex: 30,
    width: 340,
    maxWidth: 'calc(100% - 24px)',
    maxHeight: 'calc(100% - 48px)',
    overflow: 'auto',
    padding: '12px 12px 10px',
    borderRadius: 14,
    background: 'rgba(12, 12, 22, 0.94)',
    border: '1px solid #34345c',
    boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45)',
    backdropFilter: 'blur(16px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  kicker: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#8d8dff',
  },
  title: {
    margin: '2px 0 0',
    fontSize: 15,
    lineHeight: 1.3,
    fontWeight: 650,
    color: '#f4f4ff',
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: '1px solid #3a3a5e',
    background: '#1a1a2e',
    color: '#b0b0d0',
    fontSize: 12,
    flexShrink: 0,
  },
  steps: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    margin: 0,
    padding: 0,
    flexShrink: 0,
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 12,
    lineHeight: 1.4,
    color: '#b4b4d4',
  },
  stepNo: {
    width: 16,
    height: 16,
    borderRadius: 99,
    background: '#2a2a5a',
    color: '#d0d0ff',
    fontSize: 10,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    flexShrink: 0,
  },
  chip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '6px 6px 5px',
    borderRadius: 10,
    border: '1px solid #2a2a44',
    minWidth: 58,
    flexShrink: 0,
  },
  chipName: {
    fontSize: 9,
    letterSpacing: '0.04em',
    fontWeight: 600,
  },
  code: {
    margin: 0,
    maxHeight: 88,
    overflow: 'auto',
    padding: '8px 10px',
    borderRadius: 8,
    background: '#07070f',
    border: '1px solid #2a2a3e',
    color: '#9aa3c7',
    fontSize: 10,
    lineHeight: 1.45,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    flexShrink: 0,
  },
  empty: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.45,
    color: '#b4b4d4',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  primary: {
    padding: '6px 10px',
    borderRadius: 7,
    background: '#4a46e8',
    color: '#fff',
    fontSize: 12,
    fontWeight: 650,
    border: '1px solid #6a66ff',
  },
  secondary: {
    padding: '6px 10px',
    borderRadius: 7,
    background: '#22223c',
    color: '#d0d0e8',
    fontSize: 12,
    border: '1px solid #3a3a5e',
  },
  hint: {
    margin: 0,
    fontSize: 10,
    color: '#6e6e92',
    letterSpacing: '0.02em',
  },
}
