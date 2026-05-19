# Background Removal App - Project Plan

## Overview
Build a client-side React/Vite application that removes backgrounds from partially nude photos by detecting skin tone and making non-body pixels transparent. **No external services** — everything stays local.

## Core Requirements

### Functional Requirements
1. **Image Upload**
   - Accept image file input (PNG, JPG)
   - Display uploaded image in canvas

2. **Skin Tone Sampling**
   - User clicks on the image to sample a reference skin tone color
   - Visual feedback showing the sampled color

3. **Background Segmentation**
   - Use color-distance algorithm to identify body pixels vs background
   - Calculate Euclidean distance in RGB space from reference color
   - Threshold-based mask generation (tune threshold via slider)

4. **Transparency**
   - Convert pixels beyond threshold distance to transparent
   - Keep body pixels opaque

5. **Edge Refinement** (optional enhancement)
   - Apply Gaussian blur to the alpha channel mask for smoother edges
   - Reduce hard transitions between transparent/opaque

6. **Export**
   - Download result as PNG with transparency preserved

### Technical Stack
- **Framework:** React 18+ with Vite
- **Language:** JavaScript/TypeScript
- **Image Processing:** HTML5 Canvas API
- **Model/Deployment:** Claude Sonnet 4.6

### UI Components
- File upload input
- Canvas display area with uploaded image
- "Sample Skin" button (click-to-sample mode)
- Threshold slider (adjustable, real-time preview)
- Edge smoothing toggle
- Download PNG button
- Color preview showing sampled skin tone

### Algorithm Details

**Color Distance Calculation:**
```
Euclidean distance = sqrt((R - refR)² + (G - refG)² + (B - refB)²)
```

**Mask Generation:**
- For each pixel: if distance < threshold → alpha = 255 (opaque)
- Otherwise: alpha = 0 (transparent)

**Edge Smoothing (optional):**
- Apply Gaussian blur to alpha channel only
- Smooth transition at mask boundaries

### File Structure
```
src/
  ├── App.jsx
  ├── components/
  │   ├── ImageUpload.jsx
  ├── utils/
  │   ├── backgroundRemoval.js
  ├── App.css
package.json
vite.config.js
```

### Key Functions to Implement
1. `loadImage(file)` — load and display image on canvas
2. `sampleSkinTone(x, y)` — get color at clicked pixel
3. `createMask(referenceColor, threshold)` — generate transparency mask
4. `applyMask(imageData, mask)` — apply mask to image
5. `smoothEdges(mask)` — optional Gaussian blur on alpha
6. `exportPNG()` — download canvas as PNG with transparency

### User Flow
1. Upload image
2. Click "Sample Skin" mode
3. Click on image to sample skin tone
4. Adjust threshold slider to fine-tune mask (real-time preview)
5. Toggle edge smoothing if needed
6. Click "Download PNG" to export

### Constraints
- **100% client-side** — no external APIs or services
- **Privacy first** — images never leave the browser
- **No face detection required** — body-only focus
- **Real-time preview** — threshold adjustments show immediately

### Success Criteria
- Accurately segments body from background using color distance
- Exports transparent PNG preserving body details
- Threshold slider provides intuitive control
- Edge quality is acceptable (smooth or with optional blur)
- Performance is fast for typical image sizes (< 5MB)

### Future Enhancements (out of scope for MVP)
- Brush tool for manual mask refinement
- Feather/fade edges
- Multiple sampling points
- Undo/redo
- Batch processing