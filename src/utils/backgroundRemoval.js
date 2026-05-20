/**
 * Build an alpha mask (Uint8ClampedArray, one value per pixel).
 * A pixel is opaque if it falls within `threshold` distance of ANY reference color.
 *
 * @param {ImageData} imageData
 * @param {Array<[number,number,number]>} referenceColors - one or more [r,g,b] samples
 * @param {number} threshold
 */
export function createMask(imageData, referenceColors, threshold) {
  const { data, width, height } = imageData
  const mask = new Uint8ClampedArray(width * height)
  const threshSq = threshold * threshold
  const flatColors = new Int32Array(referenceColors.flat())
  const numColors = flatColors.length

  for (let i = 0; i < mask.length; i++) {
    const base = i * 4
    const r = data[base], g = data[base + 1], b = data[base + 2]
    let keep = false
    for (let c = 0; c < numColors; c += 3) {
      const dr = r - flatColors[c], dg = g - flatColors[c + 1], db = b - flatColors[c + 2]
      if (dr * dr + dg * dg + db * db <= threshSq) { keep = true; break }
    }
    mask[i] = keep ? 255 : 0
  }

  return mask
}

// Reused across calls to avoid GC pressure. Grown on demand, never shrunk.
let _smoothBuf0 = null
let _smoothBuf1 = null

/**
 * Box-blur approximation of Gaussian blur applied to the alpha mask.
 * Runs three passes using a sliding-window O(1)-per-pixel kernel instead of
 * the naive O(radius) inner loop — ~5x faster at radius=5.
 * Scratch buffers are cached at module level to eliminate per-call allocation.
 */
export function smoothMask(mask, width, height, radius = 4) {
  const n = width * height
  if (!_smoothBuf0 || _smoothBuf0.length < n) {
    _smoothBuf0 = new Float32Array(n)
    _smoothBuf1 = new Float32Array(n)
  }
  _smoothBuf0.set(mask)
  let src = _smoothBuf0, dst = _smoothBuf1

  for (let pass = 0; pass < 3; pass++) {
    // Horizontal sliding window
    for (let y = 0; y < height; y++) {
      const row = y * width
      let sum = 0, count = 0
      for (let dx = 0; dx <= radius && dx < width; dx++) { sum += src[row + dx]; count++ }
      for (let x = 0; x < width; x++) {
        dst[row + x] = sum / count
        const add = x + radius + 1
        const rem = x - radius
        if (add < width) { sum += src[row + add]; count++ }
        if (rem >= 0)    { sum -= src[row + rem]; count-- }
      }
    }
    ;[src, dst] = [dst, src]

    // Vertical sliding window
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0
      for (let dy = 0; dy <= radius && dy < height; dy++) { sum += src[dy * width + x]; count++ }
      for (let y = 0; y < height; y++) {
        dst[y * width + x] = sum / count
        const add = y + radius + 1
        const rem = y - radius
        if (add < height) { sum += src[add * width + x]; count++ }
        if (rem >= 0)     { sum -= src[rem * width + x]; count-- }
      }
    }
    ;[src, dst] = [dst, src]
  }

  // 3 complete passes = 6 swaps, so src always ends up as _smoothBuf0
  const out = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(src[i])
  return out
}

/**
 * Write the alpha mask back into imageData in place.
 * Returns the mutated imageData for chaining.
 */
export function applyMask(imageData, mask) {
  const { data } = imageData
  for (let i = 0; i < mask.length; i++) {
    data[i * 4 + 3] = mask[i]
  }
  return imageData
}

/**
 * Rasterize a polyline into a barrier mask (1 = blocked, 0 = open).
 * Points are in image coordinates. lineWidth controls barrier thickness.
 */
export function rasterizeLine(points, width, height, lineWidth = 6) {
  const offscreen = document.createElement('canvas')
  offscreen.width = width
  offscreen.height = height
  const ctx = offscreen.getContext('2d')
  ctx.strokeStyle = 'white'
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.stroke()
  const imgData = ctx.getImageData(0, 0, width, height)
  const barrier = new Uint8Array(width * height)
  for (let i = 0; i < barrier.length; i++) {
    barrier[i] = imgData.data[i * 4 + 3] > 0 ? 1 : 0
  }
  return barrier
}

// ── Intelligent Scissors (magnetic lasso) ───────────────────────────────────

/**
 * Compute Sobel gradient magnitude, normalized to [0, 1].
 * Returns Float32Array of length width * height.
 */
export function computeGradientMap(imageData, width, height) {
  const { data } = imageData
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const b = i * 4
    gray[i] = 0.299 * data[b] + 0.587 * data[b + 1] + 0.114 * data[b + 2]
  }

  const grad = new Float32Array(width * height)
  let maxG = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[y * width + (x - 1)] - gray[(y + 1) * width + (x - 1)] +
         gray[(y - 1) * width + (x + 1)] + 2 * gray[y * width + (x + 1)] + gray[(y + 1) * width + (x + 1)]
      const gy =
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + (x + 1)] +
         gray[(y + 1) * width + (x - 1)] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + (x + 1)]
      const mag = Math.sqrt(gx * gx + gy * gy)
      grad[y * width + x] = mag
      if (mag > maxG) maxG = mag
    }
  }
  if (maxG > 0) for (let i = 0; i < grad.length; i++) grad[i] /= maxG
  return grad
}

class MinHeap {
  constructor() { this._h = [] }
  push(cost, idx) {
    this._h.push({ cost, idx })
    let i = this._h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this._h[p].cost <= this._h[i].cost) break
      ;[this._h[p], this._h[i]] = [this._h[i], this._h[p]]
      i = p
    }
  }
  pop() {
    const top = this._h[0]
    const last = this._h.pop()
    if (this._h.length > 0) {
      this._h[0] = last
      let i = 0
      for (;;) {
        let s = i, l = 2 * i + 1, r = 2 * i + 2
        if (l < this._h.length && this._h[l].cost < this._h[s].cost) s = l
        if (r < this._h.length && this._h[r].cost < this._h[s].cost) s = r
        if (s === i) break
        ;[this._h[s], this._h[i]] = [this._h[i], this._h[s]]
        i = s
      }
    }
    return top
  }
  isEmpty() { return this._h.length === 0 }
}

/**
 * Run Dijkstra from (anchorX, anchorY) on the gradient cost map.
 * Returns Int32Array prevMap: prevMap[idx] = predecessor index,
 * anchorIdx = anchorIdx (root sentinel), -1 = unvisited.
 */
export function computeLivewire(gradMap, width, height, anchorX, anchorY, sensitivity, maxRadius = 450) {
  const ax = Math.round(anchorX), ay = Math.round(anchorY)
  const prev = new Int32Array(width * height).fill(-1)
  if (ax < 0 || ax >= width || ay < 0 || ay >= height) return prev

  const dist = new Float32Array(width * height).fill(Infinity)
  const visited = new Uint8Array(width * height)
  const startIdx = ay * width + ax
  dist[startIdx] = 0
  prev[startIdx] = startIdx // root sentinel

  const heap = new MinHeap()
  heap.push(0, startIdx)

  const DX = [-1, 0, 1, -1, 1, -1, 0, 1]
  const DY = [-1, -1, -1, 0, 0, 1, 1, 1]
  const DIAG = [true, false, true, false, false, true, false, true]
  const r2 = maxRadius * maxRadius

  while (!heap.isEmpty()) {
    const { cost, idx } = heap.pop()
    if (visited[idx]) continue
    visited[idx] = 1
    const x = idx % width, y = (idx / width) | 0
    if ((x - ax) ** 2 + (y - ay) ** 2 > r2) continue

    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const nIdx = ny * width + nx
      if (visited[nIdx]) continue
      const edgeCost = 1 - sensitivity * gradMap[nIdx]
      const newDist = cost + (DIAG[d] ? edgeCost * 1.414 : edgeCost)
      if (newDist < dist[nIdx]) {
        dist[nIdx] = newDist
        prev[nIdx] = idx
        heap.push(newDist, nIdx)
      }
    }
  }
  return prev
}

/**
 * Trace the shortest path from (targetX, targetY) back to the anchor.
 * Returns [{x, y}] in image coordinates, anchor-first.
 * Returns [] if target is outside the search radius (unvisited).
 */
export function traceLivewirePath(prevMap, width, targetX, targetY) {
  const path = []
  let idx = Math.round(targetY) * width + Math.round(targetX)
  if (idx < 0 || idx >= prevMap.length) return path
  if (prevMap[idx] === -1) return path // unvisited

  const maxSteps = prevMap.length
  let steps = 0
  while (steps++ < maxSteps) {
    path.push({ x: idx % width, y: (idx / width) | 0 })
    const p = prevMap[idx]
    if (p === idx) break // root
    idx = p
  }
  path.reverse()
  return path
}

// ── BFS flood fill ───────────────────────────────────────────────────────────

/**
 * BFS flood fill. Returns a Uint8Array (1 = filled) of size width*height.
 * Stops at barrier pixels.
 */
export function floodFill(width, height, startX, startY, barrier) {
  const filled = new Uint8Array(width * height)
  const sx = Math.round(startX)
  const sy = Math.round(startY)
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return filled
  const startIdx = sy * width + sx
  if (barrier[startIdx]) return filled

  const stack = [startIdx]
  filled[startIdx] = 1

  while (stack.length > 0) {
    const idx = stack.pop()
    const x = idx % width
    const y = (idx / width) | 0

    if (x > 0 && !filled[idx - 1] && !barrier[idx - 1]) { filled[idx - 1] = 1; stack.push(idx - 1) }
    if (x < width - 1 && !filled[idx + 1] && !barrier[idx + 1]) { filled[idx + 1] = 1; stack.push(idx + 1) }
    if (y > 0 && !filled[idx - width] && !barrier[idx - width]) { filled[idx - width] = 1; stack.push(idx - width) }
    if (y < height - 1 && !filled[idx + width] && !barrier[idx + width]) { filled[idx + width] = 1; stack.push(idx + width) }
  }
  return filled
}
