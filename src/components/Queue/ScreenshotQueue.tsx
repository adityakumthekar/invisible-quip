import React from "react"
import ScreenshotItem from "./ScreenshotItem"

interface Screenshot {
  path: string
  preview: string
}

interface ScreenshotQueueProps {
  isLoading: boolean
  screenshots: Screenshot[]
  onDeleteScreenshot: (index: number) => void
}

const ScreenshotQueue: React.FC<ScreenshotQueueProps> = ({
  isLoading,
  screenshots,
  onDeleteScreenshot
}) => {
  if (screenshots.length === 0) return null

  const displayScreenshots = screenshots.slice(0, 5)

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {displayScreenshots.map((screenshot, index) => (
        <div key={screenshot.path} className="w-16 shrink-0">
          <ScreenshotItem
            isLoading={isLoading}
            screenshot={screenshot}
            index={index}
            onDelete={onDeleteScreenshot}
          />
        </div>
      ))}
    </div>
  )
}

export default ScreenshotQueue
