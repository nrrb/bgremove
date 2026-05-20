import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src',
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
