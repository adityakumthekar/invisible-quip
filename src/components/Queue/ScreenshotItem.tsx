import React from "react"
import { X } from "lucide-react"

interface Screenshot {
  path: string
  preview: string
}

interface ScreenshotItemProps {
  screenshot: Screenshot
  onDelete: (index: number) => void
  index: number
  isLoading: boolean
}

const ScreenshotItem: React.FC<ScreenshotItemProps> = ({
  screenshot,
  onDelete,
  index,
  isLoading
}) => {
  return (
    <div
      className={`relative rounded-lg overflow-hidden border border-[var(--thumb-border)] aspect-video bg-[var(--thumb-bg)] ${
        isLoading ? "" : "group"
      }`}
    >
      {isLoading && (
        <div className="absolute inset-0 bg-[var(--thumb-busy)] z-10 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-[var(--thumb-spinner)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <img
        src={screenshot.preview}
        alt="Screenshot"
        className={`w-full h-full object-cover ${
          isLoading ? "opacity-50" : "group-hover:brightness-90"
        }`}
      />
      {!isLoading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void onDelete(index)
          }}
          className="absolute top-1 left-1 p-0.5 rounded-full bg-[var(--thumb-action-bg)] text-glass-heading opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Delete screenshot"
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

export default ScreenshotItem
