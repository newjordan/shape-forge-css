import React, { useState } from 'react'
import { exportSVG, exportCSSClipPath, exportPNG, exportSelectedSVG, exportSelectedPNG } from '../engine'
import { useStore } from '../store'

export default function ExportPanel() {
  const [activeTab, setActiveTab] = useState<'svg' | 'css' | 'png'>('svg')
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState(false)
  const [selectedOnly, setSelectedOnly] = useState(false)
  const selectedShapeIds = useStore((s) => s.selectedShapeIds)

  const generate = (tab: 'svg' | 'css' | 'png') => {
    setActiveTab(tab)
    setCopied(false)
    const useSelected = selectedOnly && selectedShapeIds.length > 0
    switch (tab) {
      case 'svg':
        setOutput(useSelected ? exportSelectedSVG(selectedShapeIds) : exportSVG())
        break
      case 'css': {
        const clipPath = exportCSSClipPath()
        const css = `/* Shape Forge Export */
.shape-element {
  width: 300px;
  height: 300px;
  background: linear-gradient(135deg, #4a9eff, #0044ff);
  ${clipPath}
  /* Optional effects */
  /* box-shadow: 0 0 30px rgba(74, 158, 255, 0.4); */
  /* backdrop-filter: blur(10px); */
}`
        setOutput(css)
        break
      }
      case 'png': {
        const pngPromise = useSelected ? exportSelectedPNG(selectedShapeIds, 2) : exportPNG(2)
        pngPromise.then((blob) => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'shape-forge-export.png'
          a.click()
          URL.revokeObjectURL(url)
          setOutput('PNG downloaded!')
        })
        return
      }
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadSVG = () => {
    const useSelected = selectedOnly && selectedShapeIds.length > 0
    const svg = useSelected ? exportSelectedSVG(selectedShapeIds) : exportSVG()
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shape-forge-export.svg'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={styles.panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={styles.tabs}>
          {(['svg', 'css', 'png'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => generate(tab)}
              style={{
                ...styles.tab,
                background: activeTab === tab ? '#3a3a6e' : 'transparent',
                color: activeTab === tab ? '#fff' : '#8a8aae',
              }}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: selectedShapeIds.length > 0 ? '#8a8aae' : '#4a4a5e', cursor: selectedShapeIds.length > 0 ? 'pointer' : 'default' }}>
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(e) => setSelectedOnly(e.target.checked)}
            disabled={selectedShapeIds.length === 0}
            style={{ accentColor: '#6a6aff' }}
          />
          Selected only ({selectedShapeIds.length})
        </label>
      </div>

      {output && (
        <div style={styles.outputWrap}>
          <pre style={styles.output}>{output}</pre>
          <div style={styles.actions}>
            <button onClick={copyToClipboard} style={styles.actionBtn}>
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
            {activeTab === 'svg' && (
              <button onClick={downloadSVG} style={styles.actionBtn}>
                💾 Download SVG
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#12121f',
    borderTop: '1px solid #2a2a3e',
    padding: 8,
  },
  tabs: { display: 'flex', gap: 4 },
  tab: {
    padding: '6px 16px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    border: '1px solid #2a2a3e',
  },
  outputWrap: { position: 'relative' as const },
  output: {
    background: '#0a0a14',
    border: '1px solid #2a2a3e',
    borderRadius: 6,
    padding: 10,
    fontSize: 10,
    color: '#8a8aae',
    maxHeight: 150,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    fontFamily: 'monospace',
  },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  actionBtn: {
    padding: '5px 12px',
    background: '#2a2a4e',
    borderRadius: 4,
    fontSize: 11,
    border: '1px solid #3a3a5e',
    color: '#ccc',
  },
}

