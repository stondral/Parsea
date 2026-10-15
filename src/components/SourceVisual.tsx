'use client'
import { useState } from 'react'
import { trpc } from '@/trpc/client'
import type { CitedImage } from '@/lib/rag'

export function SourceVisual({
  image,
  onExpand,
}: {
  image: CitedImage
  onExpand: (url: string) => void
}) {
  const [attempted, setAttempted] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const refreshed = trpc.chat.refreshImage.useQuery(
    { storageKey: image.storageKey || '' },
    { enabled: false, retry: false },
  )
  const url = refreshed.data?.url || image.url
  async function recover() {
    if (!image.storageKey) {
      setUnavailable(true)
      return
    }
    setAttempted(true)
    try {
      const result = await refreshed.refetch()
      setUnavailable(!result.data?.url)
    } catch {
      setUnavailable(true)
    }
  }
  return (
    <button
      type="button"
      className="chat-img-preview"
      aria-label={
        unavailable ? `Retry source image: ${image.caption}` : `Expand diagram: ${image.caption}`
      }
      onClick={() => (unavailable ? void recover() : onExpand(url))}
    >
      {unavailable ? (
        <span>Source image unavailable · retry</span>
      ) : (
        <img
          src={url}
          alt={image.caption}
          loading="lazy"
          onError={() => {
            if (!attempted) void recover()
            else setUnavailable(true)
          }}
        />
      )}
      <span className="chat-img-page-badge">Pg {image.page}</span>
    </button>
  )
}
