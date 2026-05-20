import { createMask, smoothMask, applyMask } from './backgroundRemoval.js'

self.onmessage = ({ data }) => {
  const { seq, pixelBuffer, width, height, referenceColors, threshold, doSmooth, smoothRadius } = data
  const pixels = new Uint8ClampedArray(pixelBuffer)
  const imageData = new ImageData(pixels, width, height)

  let mask = createMask(imageData, referenceColors, threshold)
  if (doSmooth) mask = smoothMask(mask, width, height, smoothRadius)
  applyMask(imageData, mask)

  self.postMessage({ seq, pixelBuffer: imageData.data.buffer }, [imageData.data.buffer])
}
