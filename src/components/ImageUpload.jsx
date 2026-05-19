import { useRef } from 'react'

export default function ImageUpload({ onImageLoaded }) {
  const inputRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      onImageLoaded(img)
    }
    img.src = url
  }

  return (
    <div className="upload-area" onClick={() => inputRef.current.click()}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <span>Click to upload image (PNG / JPG / WebP)</span>
    </div>
  )
}
