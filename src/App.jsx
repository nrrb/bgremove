import { useState, useRef, useEffect, useCallback } from 'react'
import ImageUpload from './components/ImageUpload.jsx'
import {
  createMask, smoothMask, applyMask, rasterizeLine, floodFill,
  computeGradientMap, computeLivewire, traceLivewirePath,
} from './utils/backgroundRemoval.js'

const DEFAULT_THRESHOLD = 60
const SMOOTH_RADIUS = 5

export default function App() {
  const canvasRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const sourceImageRef = useRef(null)

  const [samplingMode, setSamplingMode] = useState(false)
  const [skinColors, setSkinColors] = useState([])
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [smoothEdges, setSmoothEdges] = useState(true)
  const [hasResult, setHasResult] = useState(false)

  const [lineMode, setLineMode] = useState(false)
  const [linePhase, setLinePhase] = useState('idle') // 'idle' | 'drawing' | 'pick-side'
  const [edgeSensitivity, setEdgeSensitivity] = useState(0.7)
  const [livewireReady, setLivewireReady] = useState(false)

  const [brushMode, setBrushMode] = useState(false)
  const [brushSize, setBrushSize] = useState(20)
  const brushPaintingRef = useRef(false)

  // Undo/redo — stores ImageData snapshots
  const historyRef = useRef([])
  const historyIndexRef = useRef(-1)
  const [, forceUpdate] = useState(0)
  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current < historyRef.current.length - 1

  const gradMapRef = useRef(null)
  const livewireRef = useRef(null)
  const committedImgPathRef = useRef([])
  const anchorsDisplayRef = useRef([])

  function saveSnapshot() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height)
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1)
    historyRef.current.push(snap)
    historyIndexRef.current = historyRef.current.length - 1
    forceUpdate(n => n + 1)
  }

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current--
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.putImageData(historyRef.current[historyIndexRef.current], 0, 0)
    setSkinColors([])
    setSamplingMode(false)
    setHasResult(historyIndexRef.current > 0)
    forceUpdate(n => n + 1)
  }, [])

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current++
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.putImageData(historyRef.current[historyIndexRef.current], 0, 0)
    setSkinColors([])
    setSamplingMode(false)
    setHasResult(true)
    forceUpdate(n => n + 1)
  }, [])

  function drawOriginal(img) {
    const canvas = canvasRef.current
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
  }

  function handleImageLoaded(img) {
    sourceImageRef.current = img
    setSkinColors([])
    setHasResult(false)
    exitLineMode()
    setBrushMode(false)
    brushPaintingRef.current = false
    historyRef.current = []
    historyIndexRef.current = -1
    drawOriginal(img)
    saveSnapshot()
  }

  function handleReset() {
    if (historyRef.current.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.putImageData(historyRef.current[0], 0, 0)
    historyRef.current = [historyRef.current[0]]
    historyIndexRef.current = 0
    setSkinColors([])
    setSamplingMode(false)
    setHasResult(false)
    exitLineMode()
    setBrushMode(false)
    brushPaintingRef.current = false
    forceUpdate(n => n + 1)
  }

  // ── Color-sampling segmentation ──────────────────────────────────────────

  const applySegmentation = useCallback(() => {
    const img = sourceImageRef.current
    if (!img || skinColors.length === 0) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let mask = createMask(imageData, skinColors, threshold)
    if (smoothEdges) mask = smoothMask(mask, canvas.width, canvas.height, SMOOTH_RADIUS)
    applyMask(imageData, mask)
    ctx.putImageData(imageData, 0, 0)
    setHasResult(true)
  }, [skinColors, threshold, smoothEdges])

  useEffect(() => {
    if (skinColors.length > 0) applySegmentation()
  }, [skinColors, threshold, smoothEdges, applySegmentation])

  function handleCanvasClick(e) {
    if (!samplingMode) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = Math.floor((e.clientX - rect.left) * scaleX)
    const y = Math.floor((e.clientY - rect.top) * scaleY)
    const ctx = canvas.getContext('2d')
    const img = sourceImageRef.current
    if (!img) return
    ctx.drawImage(img, 0, 0)
    const pixel = ctx.getImageData(x, y, 1, 1).data
    setSkinColors((prev) => [...prev, [pixel[0], pixel[1], pixel[2]]])
  }

  // ── Magnetic lasso ───────────────────────────────────────────────────────

  function enterLineMode() {
    setSamplingMode(false)
    setBrushMode(false)
    setLineMode(true)
    setLinePhase('drawing')
    setLivewireReady(false)
    committedImgPathRef.current = []
    anchorsDisplayRef.current = []
    livewireRef.current = null
    clearOverlay()

    const img = sourceImageRef.current
    if (!img) return
    const offscreen = document.createElement('canvas')
    offscreen.width = img.naturalWidth
    offscreen.height = img.naturalHeight
    const ctx = offscreen.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height)
    gradMapRef.current = computeGradientMap(imageData, offscreen.width, offscreen.height)
  }

  function exitLineMode() {
    setLineMode(false)
    setLinePhase('idle')
    setLivewireReady(false)
    committedImgPathRef.current = []
    anchorsDisplayRef.current = []
    livewireRef.current = null
    gradMapRef.current = null
    clearOverlay()
  }

  // Reset path state for a new lasso without re-entering line mode.
  // Keeps the gradient map so it doesn't need to be recomputed.
  function resetLassoPath() {
    setLinePhase('drawing')
    setLivewireReady(false)
    committedImgPathRef.current = []
    anchorsDisplayRef.current = []
    livewireRef.current = null
    clearOverlay()
  }

  function clearOverlay() {
    const overlay = overlayCanvasRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    ctx.clearRect(0, 0, overlay.width, overlay.height)
  }

  function syncOverlaySize() {
    const mainCanvas = canvasRef.current
    const overlay = overlayCanvasRef.current
    if (!mainCanvas || !overlay) return
    const rect = mainCanvas.getBoundingClientRect()
    overlay.width = rect.width
    overlay.height = rect.height
  }

  function getScales() {
    const canvas = canvasRef.current
    const overlay = overlayCanvasRef.current
    if (!canvas || !overlay) return { scaleX: 1, scaleY: 1 }
    return {
      scaleX: canvas.width / overlay.width,
      scaleY: canvas.height / overlay.height,
    }
  }

  function redrawOverlay() {
    const overlay = overlayCanvasRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    ctx.clearRect(0, 0, overlay.width, overlay.height)

    const { scaleX, scaleY } = getScales()
    const toDisp = ({ x, y }) => ({ x: x / scaleX, y: y / scaleY })

    const committed = committedImgPathRef.current
    if (committed.length >= 2) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 4
      ctx.strokeStyle = '#facc15'
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const f = toDisp(committed[0])
      ctx.moveTo(f.x, f.y)
      for (let i = 1; i < committed.length; i++) {
        const p = toDisp(committed[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
      ctx.restore()
    }

    for (const anchor of anchorsDisplayRef.current) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 3
      ctx.fillStyle = '#facc15'
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }

  function redrawOverlayWithPreview(previewPath) {
    redrawOverlay()
    const overlay = overlayCanvasRef.current
    if (!overlay || previewPath.length < 2) return
    const { scaleX, scaleY } = getScales()
    const ctx = overlay.getContext('2d')
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 3
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.setLineDash([5, 5])
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.moveTo(previewPath[0].x / scaleX, previewPath[0].y / scaleY)
    for (let i = 1; i < previewPath.length; i++) {
      ctx.lineTo(previewPath[i].x / scaleX, previewPath[i].y / scaleY)
    }
    ctx.stroke()
    ctx.restore()
  }

  function getOverlayCoords(e) {
    const overlay = overlayCanvasRef.current
    const rect = overlay.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Keyboard: Enter to finish lasso, Escape to cancel, Cmd+Z/Shift+Z for undo/redo
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Enter' && linePhase === 'drawing') {
        if (committedImgPathRef.current.length >= 2) {
          setLinePhase('pick-side')
          redrawOverlay()
        }
      }
      if (e.key === 'Escape' && lineMode) {
        exitLineMode()
      }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
          (e.key === 'y' && e.ctrlKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linePhase, lineMode, undo, redo])

  // ── Eraser brush ─────────────────────────────────────────────────────────

  function applyBrush(e) {
    const overlay = overlayCanvasRef.current
    const canvas = canvasRef.current
    if (!overlay || !canvas) return
    const rect = overlay.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = Math.round((e.clientX - rect.left) * scaleX)
    const y = Math.round((e.clientY - rect.top) * scaleY)
    const ctx = canvas.getContext('2d')
    const half = Math.floor(brushSize / 2)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,1)'
    ctx.fillRect(x - half, y - half, brushSize, brushSize)
    ctx.restore()
    setHasResult(true)
  }

  function handleOverlayMouseDown(e) {
    if (!brushMode) return
    brushPaintingRef.current = true
    applyBrush(e)
  }

  function handleOverlayMouseMove(e) {
    if (linePhase === 'drawing' && livewireRef.current) {
      const pt = getOverlayCoords(e)
      const { scaleX, scaleY } = getScales()
      const imgX = Math.round(pt.x * scaleX)
      const imgY = Math.round(pt.y * scaleY)
      const { prevMap } = livewireRef.current
      const canvas = canvasRef.current
      let path = traceLivewirePath(prevMap, canvas.width, imgX, imgY)
      if (path.length === 0) {
        path = [
          { x: livewireRef.current.anchorImgX, y: livewireRef.current.anchorImgY },
          { x: imgX, y: imgY },
        ]
      }
      redrawOverlayWithPreview(path)
      return
    }
    if (brushMode && brushPaintingRef.current) {
      applyBrush(e)
    }
  }

  function handleOverlayMouseUp() {
    if (brushMode && brushPaintingRef.current) {
      brushPaintingRef.current = false
      saveSnapshot()
    }
  }

  function handleOverlayMouseLeave() {
    if (brushMode && brushPaintingRef.current) {
      brushPaintingRef.current = false
      saveSnapshot()
    }
  }

  function handleOverlayClick(e) {
    e.preventDefault()

    if (linePhase === 'drawing') {
      syncOverlaySize()
      const pt = getOverlayCoords(e)
      const { scaleX, scaleY } = getScales()
      const imgX = Math.round(pt.x * scaleX)
      const imgY = Math.round(pt.y * scaleY)

      if (livewireRef.current) {
        let path = traceLivewirePath(livewireRef.current.prevMap, canvasRef.current.width, imgX, imgY)
        if (path.length === 0) {
          path = [
            { x: livewireRef.current.anchorImgX, y: livewireRef.current.anchorImgY },
            { x: imgX, y: imgY },
          ]
        }
        if (committedImgPathRef.current.length === 0) {
          committedImgPathRef.current = [...path]
        } else {
          committedImgPathRef.current = [...committedImgPathRef.current, ...path.slice(1)]
        }
      }

      anchorsDisplayRef.current = [...anchorsDisplayRef.current, pt]

      const img = sourceImageRef.current
      if (gradMapRef.current && img) {
        setLivewireReady(false)
        const prevMap = computeLivewire(
          gradMapRef.current,
          img.naturalWidth,
          img.naturalHeight,
          imgX,
          imgY,
          edgeSensitivity,
        )
        livewireRef.current = { prevMap, anchorImgX: imgX, anchorImgY: imgY }
        setLivewireReady(true)
      }

      redrawOverlay()
      return
    }

    if (linePhase === 'pick-side') {
      const canvas = canvasRef.current
      const img = sourceImageRef.current
      if (!img) return

      const overlay = overlayCanvasRef.current
      const clickPt = getOverlayCoords(e)
      const scaleX = canvas.width / overlay.width
      const scaleY = canvas.height / overlay.height
      const clickImgX = clickPt.x * scaleX
      const clickImgY = clickPt.y * scaleY

      const ctx = canvas.getContext('2d')
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const barrier = rasterizeLine(committedImgPathRef.current, canvas.width, canvas.height)
      const filled = floodFill(canvas.width, canvas.height, clickImgX, clickImgY, barrier)

      const { data } = imageData
      for (let i = 0; i < filled.length; i++) {
        if (filled[i]) data[i * 4 + 3] = 0
      }
      ctx.putImageData(imageData, 0, 0)
      saveSnapshot()
      setHasResult(true)
      // Auto-reset path so the user can draw another lasso immediately
      resetLassoPath()
    }
  }

  function handleDownload() {
    const canvas = canvasRef.current
    const link = document.createElement('a')
    link.download = 'result.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const showOverlay = lineMode || brushMode

  const canvasWrapClass = [
    'canvas-wrap',
    samplingMode ? 'sampling' : '',
    lineMode && linePhase === 'drawing' ? 'line-drawing' : '',
    lineMode && linePhase === 'pick-side' ? 'pick-side' : '',
    brushMode ? 'brush-erasing' : '',
  ].filter(Boolean).join(' ')

  const hasAnchors = anchorsDisplayRef.current.length > 0
  const hasPath = committedImgPathRef.current.length >= 2

  return (
    <div className="app">
      <h1>BG Remove</h1>

      <div className="controls">
        <ImageUpload onImageLoaded={handleImageLoaded} />

        <div className="control-row">
          <button
            className={samplingMode ? 'btn active' : 'btn'}
            onClick={() => {
              setSamplingMode(v => !v)
              if (lineMode) exitLineMode()
              if (brushMode) setBrushMode(false)
            }}
            disabled={!sourceImageRef.current}
          >
            {samplingMode ? 'Click image to add sample…' : 'Sample Color'}
          </button>

          <button
            className={lineMode ? 'btn active' : 'btn'}
            onClick={() => { if (lineMode) exitLineMode(); else enterLineMode() }}
            disabled={!sourceImageRef.current}
          >
            {lineMode
              ? linePhase === 'drawing' ? 'Lasso: placing anchors…'
              : linePhase === 'pick-side' ? 'Lasso: click side to remove…'
              : 'Magnetic Lasso'
              : 'Magnetic Lasso'}
          </button>

          <button
            className={brushMode ? 'btn active' : 'btn'}
            onClick={() => {
              const next = !brushMode
              setBrushMode(next)
              if (next) { setSamplingMode(false); if (lineMode) exitLineMode() }
            }}
            disabled={!sourceImageRef.current}
          >
            {brushMode ? 'Eraser: painting…' : 'Eraser Brush'}
          </button>

          <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
            Undo
          </button>
          <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (⌘⇧Z)">
            Redo
          </button>

          <button
            className="btn reset-btn"
            onClick={handleReset}
            disabled={!sourceImageRef.current}
          >
            Reset
          </button>
        </div>

        {lineMode && linePhase === 'drawing' && (
          <div className="hint-block">
            {!hasAnchors
              ? <p className="hint">Click the image to place the first anchor point</p>
              : !livewireReady
              ? <p className="hint">Computing edge map…</p>
              : <p className="hint">
                  Move to preview snapped path &mdash; click to add anchors &mdash; <kbd>Enter</kbd> when done
                </p>
            }
          </div>
        )}
        {lineMode && linePhase === 'pick-side' && (
          <p className="hint">Click the side you want to remove &mdash; lasso resets automatically for a new path</p>
        )}

        {brushMode && (
          <label className="control-row">
            <span>Brush size: <strong>{brushSize}px</strong></span>
            <input
              type="range"
              min="4"
              max="200"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </label>
        )}

        {lineMode && (
          <label className="control-row">
            <span>Snap strength: <strong>{Math.round(edgeSensitivity * 100)}%</strong></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={edgeSensitivity}
              onChange={(e) => setEdgeSensitivity(Number(e.target.value))}
            />
          </label>
        )}

        {lineMode && linePhase === 'drawing' && hasPath && (
          <button className="btn" onClick={() => { setLinePhase('pick-side'); redrawOverlay() }}>
            Finish Path &rarr; Pick Side
          </button>
        )}

        {skinColors.length > 0 && (
          <div className="swatch-list">
            {skinColors.map(([r, g, b], i) => (
              <div key={i} className="swatch-wrap">
                <div className="swatch" style={{ background: `rgb(${r},${g},${b})` }} />
              </div>
            ))}
            <span className="swatch-count">{skinColors.length} sample{skinColors.length > 1 ? 's' : ''}</span>
          </div>
        )}

        <label className="control-row">
          <span>Threshold: <strong>{threshold}</strong></span>
          <input
            type="range"
            min="10"
            max="200"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </label>

        <label className="control-row">
          <input
            type="checkbox"
            checked={smoothEdges}
            onChange={(e) => setSmoothEdges(e.target.checked)}
          />
          Smooth edges
        </label>

        <button
          className="btn download-btn"
          onClick={handleDownload}
          disabled={!hasResult}
        >
          Download PNG
        </button>
      </div>

      <div className={canvasWrapClass}>
        <canvas ref={canvasRef} onClick={handleCanvasClick} />
        {showOverlay && (
          <canvas
            ref={overlayCanvasRef}
            className="overlay-canvas"
            onMouseDown={handleOverlayMouseDown}
            onMouseMove={handleOverlayMouseMove}
            onMouseUp={handleOverlayMouseUp}
            onMouseLeave={handleOverlayMouseLeave}
            onClick={handleOverlayClick}
          />
        )}
        {!sourceImageRef.current && (
          <div className="canvas-placeholder">Upload an image to get started</div>
        )}
      </div>
    </div>
  )
}
