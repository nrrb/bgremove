<script setup>
import { ref } from 'vue'

const emit = defineEmits(['image-loaded'])
const inputRef = ref(null)

function handleFile(e) {
  const file = e.target.files[0]
  if (!file) return
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    URL.revokeObjectURL(url)
    emit('image-loaded', img)
  }
  img.src = url
  e.target.value = ''
}
</script>

<template>
  <button class="tbtn" @click="inputRef.click()">
    <input
      ref="inputRef"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="hidden"
      @change="handleFile"
    />
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    Upload
  </button>
</template>
