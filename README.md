# ✂️ bgremove — Background Removal for Artists

**[Open the app → bgr.surge.sh](https://bgr.surge.sh/)** · **[Docs & README → nrrb.github.io/bgremove](https://nrrb.github.io/bgremove/)**

A free, browser-based tool for cutting subjects out of photos and saving them as transparent PNGs — perfect for reference prep, digital collage, painting studies, texture layering, and more. No account needed, no uploads, no waiting. Everything runs on your device.

---

## Why artists love it

You've got a great photo reference — but the busy background is fighting you. You need just the figure, or just the object, floating on transparency so you can drop it into your composition, your painting app, your mood board. That's exactly what this does.

- **Your images stay private.** Nothing ever leaves your browser. No server sees your photos.
- **No subscription, no watermark, no export limit.** Just open it and go.
- **Works on mobile.** Pinch to zoom, touch to paint — designed to feel natural on a tablet or phone.

---

## How to use it

### 1. Upload your photo
Drag and drop an image onto the page, or tap the upload area. JPG and PNG both work.

### 2. Pick your removal tool

You have three tools — mix and match them on the same image:

#### Color Sampler
Great for images with a clear, consistent background color (a flat wall, a white backdrop, an open sky).

1. Click **Sample Colors** to enter sampling mode.
2. Click anywhere on the background to sample that color. Click multiple spots to catch different shades.
3. Use the **Threshold** slider to expand or shrink the selection — higher threshold = more aggressive removal.
4. Toggle **Smooth Edges** to feather the boundary for a cleaner cutout.

#### Lasso (Intelligent Edge-Snapping)
Best for complex edges — hair, fabric, objects with detail. The lasso snaps to natural edges in the image automatically.

1. Click **Lasso** to enter lasso mode.
2. Click to place anchor points around your subject, tracing its outline. The line will hug the edges it finds.
3. Close the loop back to your first anchor, then click inside or outside to choose which side to remove.
4. Adjust **Edge Sensitivity** to control how strongly the lasso snaps to edges.

#### Brush
For manual touch-ups, or when you want full control over exactly what gets removed.

1. Click **Brush** to enter brush mode.
2. Paint over any area to erase it to transparency.
3. Use the **Brush Size** slider to work broadly or precisely.

### 3. Refine and undo
Made a mistake? Hit **Undo** (or Ctrl/Cmd+Z). Changed your mind? **Redo** brings it back. You can also **Reset** to start over from your original photo.

### 4. Export
Hit **Save** to download your cutout as a PNG. The transparent areas will be preserved — ready for Procreate, Photoshop, Affinity, GIMP, or wherever your workflow takes you.

### Need a reminder?
The **Help** button in the bottom toolbar opens this page in a new tab so you can refer back to it without losing your work.

---

## Tips for great results

- **Start with the color sampler** on simple backgrounds, then use the brush to clean up any leftover bits.
- For figures with complex hair or fur, try the lasso first — it follows edges surprisingly well.
- **Sample multiple background colors** if your backdrop isn't perfectly even. The tool averages across all your samples.
- Zoom in with the scroll wheel (or pinch on mobile) to paint fine details with the brush.
- The threshold slider updates the preview in real time — drag it slowly to find the sweet spot before it clips into your subject.

---

## Built with

- [Vue 3](https://vuejs.org/) — reactive UI
- [Vite](https://vitejs.dev/) — fast builds
- [Tailwind CSS](https://tailwindcss.com/) — styling
- HTML5 Canvas API + Web Workers — all image processing runs locally in your browser

---

## Running locally

```bash
git clone https://github.com/nicholasbennett/bgremove
cd bgremove
npm install
npm run dev
```

Then open `http://localhost:5173`.

To build for production:

```bash
npm run build
```

---

## License

Do whatever you like with it. Make something beautiful.
