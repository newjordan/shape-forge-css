import React, { useState, useEffect, useCallback } from 'react'
import paper from 'paper'
import { useStore } from '../store'
import { STYLE_PRESETS } from '../types'
import type { ShapeStyle } from '../types'
import { getDrawLayer, applyStyle } from '../engine'

export default function PropertiesPanel() {
  const currentStyle = useStore((s) => s.currentStyle)
  const setCurrentStyle = useStore((s) => s.setCurrentStyle)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)
  const shapes = useStore((s) => s.shapes)
  const updateShape = useStore((s) => s.updateShape)

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
      }
    }
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
  }, [getSelectedItem])

  const hasSingleSelection = selectedShapeIds.length === 1

  return (
    <div style={styles.panel}>
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
}

