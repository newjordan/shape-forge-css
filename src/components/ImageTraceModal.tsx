import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { TraceOptions, TraceResult } from '../types'
import { DEFAULT_TRACE_OPTIONS } from '../types'
import { loadImageFromFile, loadImagePixels, advancedTrace } from '../engine'

interface Props {
  file: File
  onAccept: (result: TraceResult, options: TraceOptions) => void
  onCancel: () => void
}

export default function ImageTraceModal({ file, onAccept, onCancel }: Props) {
  const [options, setOptions] = useState<TraceOptions>({ ...DEFAULT_TRACE_OPTIONS })
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [pixelData, setPixelData] = useState<{
    pixels: Uint8ClampedArray; sw: number; sh: number; ds: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const debounceRef = useRef<number>(0)

  // Load image on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await loadImageFromFile(file)
        if (cancelled) return
        setImg(loaded)
        const pd = loadImagePixels(loaded)
        if (cancelled) return
        setPixelData(pd)
        setLoading(false)
      } catch {
        // image load failed — silently ignore
      }
    })()
    return () => { cancelled = true }
  }, [file])

  // Re-trace when options or pixel data change (debounced)
  const runTrace = useCallback(() => {
    if (!pixelData) return
    const result = advancedTrace(pixelData.pixels, pixelData.sw, pixelData.sh, pixelData.ds, options)
    setTraceResult(result)
  }, [pixelData, options])

  useEffect(() => {
    if (!pixelData) return
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(runTrace, 80)
    return () => window.clearTimeout(debounceRef.current)
  }, [runTrace, pixelData])

  // Draw preview
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!

    // Fit image into preview area
    const maxW = canvas.width, maxH = canvas.height
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    const ox = (maxW - dw) / 2
    const oy = (maxH - dh) / 2

    ctx.clearRect(0, 0, maxW, maxH)

    // Checkerboard background for transparency
    const cSize = 8
    for (let y = 0; y < maxH; y += cSize) {
      for (let x = 0; x < maxW; x += cSize) {
        const dark = ((x / cSize | 0) + (y / cSize | 0)) % 2 === 0
        ctx.fillStyle = dark ? '#1a1a2e' : '#222240'
        ctx.fillRect(x, y, cSize, cSize)
      }
    }

    // Draw original image
    ctx.globalAlpha = 0.4
    ctx.drawImage(img, ox, oy, dw, dh)
    ctx.globalAlpha = 1

    // Draw traced contours
    if (traceResult) {
      const pxScale = scale
      for (const contour of traceResult.contours) {
        if (!contour.enabled) continue
        ctx.beginPath()
        const pts = contour.points
        if (pts.length === 0) continue
        ctx.moveTo(ox + pts[0].x * pxScale, oy + pts[0].y * pxScale)
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(ox + pts[i].x * pxScale, oy + pts[i].y * pxScale)
        }
        ctx.closePath()
        ctx.fillStyle = contour.isHole
          ? 'rgba(255, 80, 80, 0.15)'
          : 'rgba(100, 200, 255, 0.2)'
        ctx.fill()
        ctx.strokeStyle = contour.isHole ? '#ff5050' : '#64c8ff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }, [img, traceResult])

  const opt = (key: keyof TraceOptions, val: TraceOptions[keyof TraceOptions]) =>
    setOptions(prev => ({ ...prev, [key]: val }))

  const toggleContour = (id: number) => {
    if (!traceResult) return
    setTraceResult({
      ...traceResult,
      contours: traceResult.contours.map(c =>
        c.id === id ? { ...c, enabled: !c.enabled } : c
      ),
    })
  }

  const removeContour = (id: number) => {
    if (!traceResult) return
    setTraceResult({
      ...traceResult,
      contours: traceResult.contours.filter(c => c.id !== id),
    })
  }

  const enabledCount = traceResult?.contours.filter(c => c.enabled).length ?? 0
  const totalCount = traceResult?.contours.length ?? 0

  return (
    <div style={S.backdrop} onClick={onCancel}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <span style={S.headerTitle}>📷 Image Trace</span>
          <span style={S.headerSub}>
            {loading ? 'Loading…' : `${totalCount} contours found · ${enabledCount} enabled`}
          </span>
          <button onClick={onCancel} style={S.closeBtn}>✕</button>
        </div>

        <div style={S.body}>
          {/* Preview canvas */}
          <div style={S.previewWrap}>
            <canvas ref={previewCanvasRef} width={520} height={420} style={S.previewCanvas} />
          </div>

          {/* Controls panel */}
          <div style={S.controls}>
            <div style={S.ctrlSection}>
              <div style={S.ctrlTitle}>CHANNEL</div>
              <div style={S.channelRow}>
                {(['alpha', 'luminance', 'red', 'green', 'blue'] as const).map(ch => (
                  <button key={ch} onClick={() => opt('channel', ch)}
                    style={{
                      ...S.channelBtn,
                      background: options.channel === ch ? '#3a3a6e' : '#1a1a2e',
                      borderColor: options.channel === ch ? '#6a6aff' : '#2a2a3e',
                    }}
                  >{ch[0].toUpperCase()}</button>
                ))}
              </div>
            </div>

            <Slider label="Threshold" value={options.threshold} min={1} max={254} step={1}
              onChange={v => opt('threshold', v)} display={`${options.threshold}`} />
            <Slider label="Blur" value={options.blurRadius} min={0} max={10} step={0.5}
              onChange={v => opt('blurRadius', v)} display={`${options.blurRadius.toFixed(1)}`} />
            <Slider label="Smoothing" value={options.simplifyTolerance} min={0.5} max={20} step={0.5}
              onChange={v => opt('simplifyTolerance', v)} display={`${options.simplifyTolerance.toFixed(1)}`} />
            <Slider label="Min Area" value={options.minArea} min={0} max={500} step={5}
              onChange={v => opt('minArea', v)} display={`${options.minArea}px²`} />
            <Slider label="Offset" value={options.pathOffset} min={-50} max={50} step={1}
              onChange={v => opt('pathOffset', v)} display={`${options.pathOffset}px`} />
            <Slider label="Corner ∠" value={options.cornerAngle} min={10} max={180} step={5}
              onChange={v => opt('cornerAngle', v)} display={`${options.cornerAngle}°`} />

            <div style={S.ctrlSection}>
              <label style={S.checkRow}>
                <input type="checkbox" checked={options.invert}
                  onChange={e => opt('invert', e.target.checked)}
                  style={{ accentColor: '#6a6aff' }} />
                <span>Invert (trace negative space)</span>
              </label>
            </div>

            {/* Contour list */}
            <div style={S.ctrlTitle}>CONTOURS ({totalCount})</div>
            <div style={S.contourList}>
              {traceResult?.contours.map(c => (
                <div key={c.id} style={{
                  ...S.contourItem,
                  opacity: c.enabled ? 1 : 0.4,
                  borderColor: c.isHole ? '#ff505040' : '#64c8ff40',
                }}>
                  <input type="checkbox" checked={c.enabled}
                    onChange={() => toggleContour(c.id)}
                    style={{ accentColor: c.isHole ? '#ff5050' : '#64c8ff', flexShrink: 0 }} />
                  <div style={S.contourInfo}>
                    <span style={{ color: c.isHole ? '#ff8080' : '#90d0ff', fontSize: 10, fontWeight: 600 }}>
                      {c.isHole ? 'Hole' : 'Outer'}
                    </span>
                    <span style={S.contourMeta}>
                      {Math.round(c.area)}px² · {c.pointCount}pts
                    </span>
                  </div>
                  <button onClick={() => removeContour(c.id)} style={S.contourDel} title="Remove">✕</button>
                </div>
              ))}
              {totalCount === 0 && !loading && (
                <div style={{ ...S.contourMeta, padding: 12, textAlign: 'center' }}>
                  No contours detected. Try adjusting threshold or channel.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button onClick={onCancel} style={S.cancelBtn}>Cancel</button>
          <button
            onClick={() => traceResult && onAccept(traceResult, options)}
            disabled={enabledCount === 0}
            style={{ ...S.acceptBtn, opacity: enabledCount === 0 ? 0.4 : 1 }}
          >
            Accept ({enabledCount} contour{enabledCount !== 1 ? 's' : ''})
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Slider sub-component ---
function Slider({ label, value, min, max, step, onChange, display }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; display: string
}) {
  return (
    <div style={S.sliderRow}>
      <label style={S.sliderLabel}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={S.slider} />
      <span style={S.sliderVal}>{display}</span>
    </div>
  )
}

// --- Styles ---
const S: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: '#12121f', borderRadius: 12, border: '1px solid #2a2a3e',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    width: 900, maxWidth: '95vw', maxHeight: '92vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    padding: '12px 16px', borderBottom: '1px solid #2a2a3e',
    display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
  },
  headerTitle: { fontSize: 14, fontWeight: 700, color: '#e0e0f0' },
  headerSub: { fontSize: 11, color: '#6a6a8e', flex: 1 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 6, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: '#1a1a2e', border: '1px solid #2a2a3e', color: '#8a8aae',
    fontSize: 13, cursor: 'pointer',
  },
  body: {
    display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0,
  },
  previewWrap: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 12, background: '#0a0a14', minWidth: 0,
  },
  previewCanvas: {
    borderRadius: 6, border: '1px solid #2a2a3e', maxWidth: '100%', maxHeight: '100%',
  },
  controls: {
    width: 280, flexShrink: 0, borderLeft: '1px solid #2a2a3e',
    padding: '8px 0', overflowY: 'auto',
  },
  ctrlSection: { padding: '4px 12px', marginBottom: 4 },
  ctrlTitle: {
    fontSize: 10, fontWeight: 700, color: '#6a6a8e', letterSpacing: '0.08em',
    padding: '6px 12px 4px', flexShrink: 0,
  },
  channelRow: { display: 'flex', gap: 4, marginTop: 4 },
  channelBtn: {
    flex: 1, padding: '4px 0', borderRadius: 4, border: '1px solid #2a2a3e',
    fontSize: 10, fontWeight: 600, color: '#c0c0e0', cursor: 'pointer',
    textAlign: 'center' as const,
  },
  checkRow: {
    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
    fontSize: 11, color: '#b0b0d0',
  },
  sliderRow: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px',
  },
  sliderLabel: { fontSize: 10, color: '#8a8aae', width: 58, flexShrink: 0 },
  slider: { flex: 1, accentColor: '#6a6aff', height: 4 },
  sliderVal: { fontSize: 10, color: '#6a6a8e', width: 42, textAlign: 'right' as const },
  contourList: {
    maxHeight: 180, overflowY: 'auto' as const, padding: '0 8px',
  },
  contourItem: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px',
    borderRadius: 4, border: '1px solid transparent', marginBottom: 2,
    transition: 'opacity 0.15s',
  },
  contourInfo: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 1, minWidth: 0,
  },
  contourMeta: { fontSize: 9, color: '#5a5a7e' },
  contourDel: {
    width: 20, height: 20, borderRadius: 4, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', color: '#5a5a7e',
    fontSize: 10, cursor: 'pointer', flexShrink: 0,
  },
  footer: {
    padding: '10px 16px', borderTop: '1px solid #2a2a3e',
    display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0,
  },
  cancelBtn: {
    padding: '6px 16px', borderRadius: 6, border: '1px solid #2a2a3e',
    background: '#1a1a2e', color: '#8a8aae', fontSize: 12, cursor: 'pointer',
  },
  acceptBtn: {
    padding: '6px 20px', borderRadius: 6, border: '1px solid #4a6aff',
    background: '#3a3a6e', color: '#e0e0ff', fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
  },
}

