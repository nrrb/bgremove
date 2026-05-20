<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import ImageUpload from './components/ImageUpload.vue'
import {
  createMask, smoothMask, applyMask, rasterizeLine, floodFill,
  computeGradientMap, computeLivewire, traceLivewirePath,
} from './utils/backgroundRemoval.js'

const DEFAULT_THRESHOLD = 60
const SMOOTH_RADIUS = 5

// Template refs
const canvasRef = ref(null)
const overlayRef = ref(null)

// Image & result state
const sourceImage = ref(null)
const hasResult = ref(false)

// Sampling tool
const samplingMode = ref(false)
const skinColors = ref([])
const threshold = ref(DEFAULT_THRESHOLD)
const smoothEdges = ref(true)

// Lasso tool
const lineMode = ref(false)
const linePhase = ref('idle') // 'idle' | 'drawing' | 'pick-side'
const edgeSensitivity = ref(0.7)
const livewireReady = ref(false)
const gradMap = ref(null)
const livewireData = ref(null)
const committedPath = ref([])
const anchorsDisplay = ref([])

// Brush tool
const brushMode = ref(false)
const brushSize = ref(20)
const brushPainting = ref(false)

// History
const historySnaps = ref([])
const historyIdx = ref(-1)

// Derived
const canUndo = computed(() => historyIdx.value > 0)
const canRedo = computed(() => historyIdx.value < historySnaps.value.length - 1)
const hasImage = computed(() => sourceImage.value !== null)
const showOverlay = computed(() => lineMode.value || brushMode.value)
const hasAnchors = computed(() => anchorsDisplay.value.length > 0)
const hasPath = computed(() => committedPath.value.length >= 2)

const activeToolPanel = computed(() => {
  if (samplingMode.value) return 'sample'
  if (lineMode.value) return 'lasso'
  if (brushMode.value) return 'brush'
  return null
})

const cursorClass = computed(() => {
  if (samplingMode.value || brushMode.value || (lineMode.value && linePhase.value === 'drawing'))
    return 'cursor-crosshair'
  if (lineMode.value && linePhase.value === 'pick-side') return 'cursor-cell'
  return ''
})

// ── History ──────────────────────────────────────────────────────────────────

function saveSnapshot() {
  const canvas = canvasRef.value
  if (!canvas) return
  const snap = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  historySnaps.value = historySnaps.value.slice(0, historyIdx.value + 1)
  historySnaps.value.push(snap)
  historyIdx.value = historySnaps.value.length - 1
}

function undo() {
  if (historyIdx.value <= 0) return
  historyIdx.value--
  canvasRef.value.getContext('2d').putImageData(historySnaps.value[historyIdx.value], 0, 0)
  skinColors.value = []
  samplingMode.value = false
  hasResult.value = historyIdx.value > 0
}

function redo() {
  if (historyIdx.value >= historySnaps.value.length - 1) return
  historyIdx.value++
  canvasRef.value.getContext('2d').putImageData(historySnaps.value[historyIdx.value], 0, 0)
  skinColors.value = []
  samplingMode.value = false
  hasResult.value = true
}

// ── Image load / reset ───────────────────────────────────────────────────────

function handleImageLoaded(img) {
  sourceImage.value = img
  skinColors.value = []
  hasResult.value = false
  exitLineMode()
  brushMode.value = false
  brushPainting.value = false
  historySnaps.value = []
  historyIdx.value = -1
  const canvas = canvasRef.value
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  saveSnapshot()
}

function handleReset() {
  if (historySnaps.value.length === 0) return
  canvasRef.value.getContext('2d').putImageData(historySnaps.value[0], 0, 0)
  historySnaps.value = [historySnaps.value[0]]
  historyIdx.value = 0
  skinColors.value = []
  samplingMode.value = false
  hasResult.value = false
  exitLineMode()
  brushMode.value = false
  brushPainting.value = false
}

// ── Color sampling ───────────────────────────────────────────────────────────

function applySegmentation() {
  const img = sourceImage.value
  if (!img || skinColors.value.length === 0) return
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let mask = createMask(imageData, skinColors.value, threshold.value)
  if (smoothEdges.value) mask = smoothMask(mask, canvas.width, canvas.height, SMOOTH_RADIUS)
  applyMask(imageData, mask)
  ctx.putImageData(imageData, 0, 0)
  hasResult.value = true
}

watch([() => skinColors.value.length, threshold, smoothEdges], () => {
  if (skinColors.value.length > 0) applySegmentation()
})

function handleCanvasClick(e) {
  if (!samplingMode.value) return
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width))
  const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(sourceImage.value, 0, 0)
  const pixel = ctx.getImageData(x, y, 1, 1).data
  skinColors.value = [...skinColors.value, [pixel[0], pixel[1], pixel[2]]]
}

// ── Lasso helpers ────────────────────────────────────────────────────────────

function clearOverlay() {
  const ov = overlayRef.value
  if (!ov) return
  ov.getContext('2d').clearRect(0, 0, ov.width, ov.height)
}

function syncOverlaySize() {
  const canvas = canvasRef.value
  const ov = overlayRef.value
  if (!canvas || !ov) return
  const rect = canvas.getBoundingClientRect()
  ov.width = rect.width
  ov.height = rect.height
}

function getScales() {
  const canvas = canvasRef.value
  const ov = overlayRef.value
  if (!canvas || !ov || !ov.width) return { scaleX: 1, scaleY: 1 }
  return { scaleX: canvas.width / ov.width, scaleY: canvas.height / ov.height }
}

function redrawOverlay() {
  const ov = overlayRef.value
  if (!ov) return
  const ctx = ov.getContext('2d')
  ctx.clearRect(0, 0, ov.width, ov.height)
  const { scaleX, scaleY } = getScales()
  const d = ({ x, y }) => ({ x: x / scaleX, y: y / scaleY })

  const committed = committedPath.value
  if (committed.length >= 2) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 4
    ctx.strokeStyle = '#facc15'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    const f = d(committed[0])
    ctx.moveTo(f.x, f.y)
    for (let i = 1; i < committed.length; i++) { const p = d(committed[i]); ctx.lineTo(p.x, p.y) }
    ctx.stroke()
    ctx.restore()
  }

  for (const anchor of anchorsDisplay.value) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 3
    ctx.fillStyle = '#facc15'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(anchor.x, anchor.y, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

function redrawOverlayWithPreview(previewPath) {
  redrawOverlay()
  const ov = overlayRef.value
  if (!ov || previewPath.length < 2) return
  const { scaleX, scaleY } = getScales()
  const ctx = ov.getContext('2d')
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
  const rect = overlayRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

// ── Lasso tool ───────────────────────────────────────────────────────────────

function enterLineMode() {
  samplingMode.value = false
  brushMode.value = false
  lineMode.value = true
  linePhase.value = 'drawing'
  livewireReady.value = false
  committedPath.value = []
  anchorsDisplay.value = []
  livewireData.value = null
  gradMap.value = null
  clearOverlay()
  const img = sourceImage.value
  if (!img) return
  const off = document.createElement('canvas')
  off.width = img.naturalWidth
  off.height = img.naturalHeight
  const ctx = off.getContext('2d')
  ctx.drawImage(img, 0, 0)
  gradMap.value = computeGradientMap(ctx.getImageData(0, 0, off.width, off.height), off.width, off.height)
}

function exitLineMode() {
  lineMode.value = false
  linePhase.value = 'idle'
  livewireReady.value = false
  committedPath.value = []
  anchorsDisplay.value = []
  livewireData.value = null
  gradMap.value = null
  clearOverlay()
}

function resetLassoPath() {
  linePhase.value = 'drawing'
  livewireReady.value = false
  committedPath.value = []
  anchorsDisplay.value = []
  livewireData.value = null
  clearOverlay()
}

function finishLassoPath() {
  if (committedPath.value.length >= 2) {
    linePhase.value = 'pick-side'
    redrawOverlay()
  }
}

// ── Brush tool ───────────────────────────────────────────────────────────────

function applyBrush(e) {
  const ov = overlayRef.value
  const canvas = canvasRef.value
  if (!ov || !canvas) return
  const rect = ov.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  const x = Math.round((e.clientX - rect.left) * scaleX)
  const y = Math.round((e.clientY - rect.top) * scaleY)
  const ctx = canvas.getContext('2d')
  const half = Math.floor(brushSize.value / 2)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.fillRect(x - half, y - half, brushSize.value, brushSize.value)
  ctx.restore()
  hasResult.value = true
}

// ── Overlay pointer events ───────────────────────────────────────────────────

function handleOverlayPointerDown(e) {
  if (brushMode.value) {
    brushPainting.value = true
    overlayRef.value.setPointerCapture(e.pointerId)
    applyBrush(e)
  }
}

function handleOverlayPointerMove(e) {
  if (e.pointerType === 'mouse' && linePhase.value === 'drawing' && livewireData.value) {
    const pt = getOverlayCoords(e)
    const { scaleX, scaleY } = getScales()
    const imgX = Math.round(pt.x * scaleX)
    const imgY = Math.round(pt.y * scaleY)
    const canvas = canvasRef.value
    let path = traceLivewirePath(livewireData.value.prevMap, canvas.width, imgX, imgY)
    if (path.length === 0) {
      path = [{ x: livewireData.value.anchorImgX, y: livewireData.value.anchorImgY }, { x: imgX, y: imgY }]
    }
    redrawOverlayWithPreview(path)
    return
  }
  if (brushMode.value && brushPainting.value) applyBrush(e)
}

function handleOverlayPointerUp() {
  if (brushMode.value && brushPainting.value) {
    brushPainting.value = false
    saveSnapshot()
  }
}

function handleOverlayPointerLeave() {
  if (brushMode.value && brushPainting.value) {
    brushPainting.value = false
    saveSnapshot()
  }
}

function handleOverlayClick(e) {
  e.preventDefault()
  syncOverlaySize()

  if (linePhase.value === 'drawing') {
    const pt = getOverlayCoords(e)
    const { scaleX, scaleY } = getScales()
    const imgX = Math.round(pt.x * scaleX)
    const imgY = Math.round(pt.y * scaleY)

    if (livewireData.value) {
      let path = traceLivewirePath(livewireData.value.prevMap, canvasRef.value.width, imgX, imgY)
      if (path.length === 0) {
        path = [{ x: livewireData.value.anchorImgX, y: livewireData.value.anchorImgY }, { x: imgX, y: imgY }]
      }
      committedPath.value = committedPath.value.length === 0
        ? [...path]
        : [...committedPath.value, ...path.slice(1)]
    }

    anchorsDisplay.value = [...anchorsDisplay.value, pt]

    const img = sourceImage.value
    if (gradMap.value && img) {
      livewireReady.value = false
      const prevMap = computeLivewire(
        gradMap.value, img.naturalWidth, img.naturalHeight, imgX, imgY, edgeSensitivity.value,
      )
      livewireData.value = { prevMap, anchorImgX: imgX, anchorImgY: imgY }
      livewireReady.value = true
    }
    redrawOverlay()
    return
  }

  if (linePhase.value === 'pick-side') {
    const canvas = canvasRef.value
    if (!sourceImage.value) return
    const ov = overlayRef.value
    const clickPt = getOverlayCoords(e)
    const clickImgX = clickPt.x * (canvas.width / ov.width)
    const clickImgY = clickPt.y * (canvas.height / ov.height)
    const ctx = canvas.getContext('2d')
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const barrier = rasterizeLine(committedPath.value, canvas.width, canvas.height)
    const filled = floodFill(canvas.width, canvas.height, clickImgX, clickImgY, barrier)
    const { data } = imageData
    for (let i = 0; i < filled.length; i++) {
      if (filled[i]) data[i * 4 + 3] = 0
    }
    ctx.putImageData(imageData, 0, 0)
    saveSnapshot()
    hasResult.value = true
    resetLassoPath()
  }
}

// ── Toolbar actions ──────────────────────────────────────────────────────────

function toggleSample() {
  const next = !samplingMode.value
  samplingMode.value = next
  if (next) { if (lineMode.value) exitLineMode(); brushMode.value = false }
}

function toggleLasso() {
  if (lineMode.value) exitLineMode()
  else enterLineMode()
}

function toggleBrush() {
  const next = !brushMode.value
  brushMode.value = next
  if (next) { samplingMode.value = false; if (lineMode.value) exitLineMode() }
}

function handleDownload() {
  const link = document.createElement('a')
  link.download = 'result.png'
  link.href = canvasRef.value.toDataURL('image/png')
  link.click()
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

function onKeyDown(e) {
  if (e.key === 'Enter' && linePhase.value === 'drawing') finishLassoPath()
  if (e.key === 'Escape' && lineMode.value) exitLineMode()
  if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); undo() }
  if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) || (e.key === 'y' && e.ctrlKey)) {
    e.preventDefault(); redo()
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))

// Sync overlay size when it becomes visible
watch(showOverlay, async (val) => {
  if (val) { await nextTick(); syncOverlaySize() }
})
</script>

<template>
  <div class="h-dvh flex flex-col bg-neutral-900 text-neutral-100 overflow-hidden select-none">

    <!-- Canvas area -->
    <div class="flex-1 min-h-0 overflow-auto flex items-start justify-center p-3">
      <div class="relative rounded-xl overflow-hidden bg-checker inline-block max-w-full" :class="cursorClass">
        <canvas
          ref="canvasRef"
          class="block max-w-full h-auto"
          @click="handleCanvasClick"
        />
        <canvas
          v-if="showOverlay"
          ref="overlayRef"
          class="absolute inset-0 w-full h-full touch-none"
          @pointerdown="handleOverlayPointerDown"
          @pointermove="handleOverlayPointerMove"
          @pointerup="handleOverlayPointerUp"
          @pointerleave="handleOverlayPointerLeave"
          @click="handleOverlayClick"
        />
        <div
          v-if="!hasImage"
          class="px-12 py-20 text-neutral-500 text-sm text-center pointer-events-none"
        >
          Upload an image to get started
        </div>
      </div>
    </div>

    <!-- Active tool panel -->
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      leave-active-class="transition-all duration-100 ease-in"
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="activeToolPanel"
        class="bg-neutral-800 border-t border-neutral-700 px-4 py-3 flex flex-col gap-2.5"
      >
        <!-- Sample Color panel -->
        <template v-if="activeToolPanel === 'sample'">
          <div class="flex items-center gap-3">
            <span class="text-xs text-neutral-400 shrink-0 w-28">Threshold: <strong class="text-neutral-200">{{ threshold }}</strong></span>
            <input type="range" min="10" max="200" v-model.number="threshold" class="flex-1 accent-blue-500" />
          </div>
          <label class="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" v-model="smoothEdges" class="accent-blue-500" />
            Smooth edges
          </label>
          <div v-if="skinColors.length > 0" class="flex items-center flex-wrap gap-1.5">
            <div
              v-for="([r, g, b], i) in skinColors" :key="i"
              class="w-5 h-5 rounded border border-neutral-600 shrink-0"
              :style="{ background: `rgb(${r},${g},${b})` }"
            />
            <span class="text-xs text-neutral-500">{{ skinColors.length }} sample{{ skinColors.length !== 1 ? 's' : '' }}</span>
          </div>
          <p class="text-xs text-yellow-400/85">Tap the image to sample background colors</p>
        </template>

        <!-- Lasso panel -->
        <template v-else-if="activeToolPanel === 'lasso'">
          <div class="flex items-center gap-3">
            <span class="text-xs text-neutral-400 shrink-0 w-32">Snap strength: <strong class="text-neutral-200">{{ Math.round(edgeSensitivity * 100) }}%</strong></span>
            <input type="range" min="0" max="1" step="0.05" v-model.number="edgeSensitivity" class="flex-1 accent-blue-500" />
          </div>
          <p v-if="linePhase === 'drawing'" class="text-xs text-yellow-400/85">
            <span v-if="!hasAnchors">Tap the image to place the first anchor</span>
            <span v-else-if="!livewireReady">Computing edge map…</span>
            <span v-else>Tap to add anchors · mouse hover previews path</span>
          </p>
          <p v-else-if="linePhase === 'pick-side'" class="text-xs text-yellow-400/85">
            Tap the side you want to remove — lasso resets automatically
          </p>
          <div class="flex gap-2">
            <button v-if="linePhase === 'drawing' && hasPath" @click="finishLassoPath" class="pill-btn">
              Finish path →
            </button>
            <button @click="exitLineMode" class="pill-btn">Cancel</button>
          </div>
        </template>

        <!-- Brush panel -->
        <template v-else-if="activeToolPanel === 'brush'">
          <div class="flex items-center gap-3">
            <span class="text-xs text-neutral-400 shrink-0 w-24">Brush: <strong class="text-neutral-200">{{ brushSize }}px</strong></span>
            <input type="range" min="4" max="200" v-model.number="brushSize" class="flex-1 accent-blue-500" />
          </div>
          <p class="text-xs text-yellow-400/85">Paint over areas to erase them</p>
        </template>
      </div>
    </Transition>

    <!-- Bottom toolbar -->
    <div class="bg-neutral-800 border-t border-neutral-700 px-1 py-1 flex items-center safe-pb">
      <ImageUpload @image-loaded="handleImageLoaded" />

      <button class="tbtn" :class="{ active: samplingMode }" @click="toggleSample" :disabled="!hasImage">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
        </svg>
        Sample
      </button>

      <button class="tbtn" :class="{ active: lineMode }" @click="toggleLasso" :disabled="!hasImage">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 20c-4.4 0-8-2.7-8-6 0-2 1.4-3.7 3.5-4.8C8.6 7.7 10.2 7 12 7c4.4 0 8 2.7 8 6s-3.6 7-8 7z"/>
          <path d="M12 7V3m0 0-2 2m2-2 2 2"/>
        </svg>
        Lasso
      </button>

      <button class="tbtn" :class="{ active: brushMode }" @click="toggleBrush" :disabled="!hasImage">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L4.22 13.45a2 2 0 0 0 0 2.83l3.5 3.5a2 2 0 0 0 2.83 0l8.84-8.84a5.5 5.5 0 0 0 1.45-5.33z"/>
          <path d="M7.5 20.5 3 21l.5-4.5"/>
        </svg>
        Erase
      </button>

      <button class="tbtn" @click="undo" :disabled="!canUndo">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M3 7v6h6"/><path d="M3 13c1.7-4.3 6-7 11-7a11 11 0 0 1 7 2.5"/>
        </svg>
        Undo
      </button>

      <button class="tbtn" @click="redo" :disabled="!canRedo">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M21 7v6h-6"/><path d="M21 13c-1.7-4.3-6-7-11-7a11 11 0 0 0-7 2.5"/>
        </svg>
        Redo
      </button>

      <button class="tbtn tbtn-green" @click="handleDownload" :disabled="!hasResult">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Save
      </button>

      <button class="tbtn tbtn-red" @click="handleReset" :disabled="!hasImage">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
        </svg>
        Reset
      </button>
    </div>

  </div>
</template>
