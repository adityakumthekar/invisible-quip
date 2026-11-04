import { describe, expect, it } from "vitest"
import { cursorRelayPoint } from "./cursorRelay"

const bounds = { x: 100, y: 200, width: 400, height: 80 }
const listening = { ignoringMouseEvents: true, dragging: false, visible: true }

describe("cursorRelayPoint", () => {
  it("injects a window-local point while click-through is on and the cursor is inside", () => {
    expect(cursorRelayPoint({ x: 150.4, y: 240.2 }, bounds, listening)).toEqual({
      x: 50,
      y: 40
    })
  })

  it("stays quiet outside the window, while dragging, or once real events flow", () => {
    expect(cursorRelayPoint({ x: 99, y: 240 }, bounds, listening)).toBeNull()
    expect(cursorRelayPoint({ x: 500, y: 240 }, bounds, listening)).toBeNull()
    expect(cursorRelayPoint({ x: 150, y: 199 }, bounds, listening)).toBeNull()
    expect(cursorRelayPoint({ x: 150, y: 280 }, bounds, listening)).toBeNull()
    expect(
      cursorRelayPoint({ x: 150, y: 240 }, bounds, {
        ...listening,
        ignoringMouseEvents: false
      })
    ).toBeNull()
    expect(
      cursorRelayPoint({ x: 150, y: 240 }, bounds, { ...listening, dragging: true })
    ).toBeNull()
    expect(
      cursorRelayPoint({ x: 150, y: 240 }, bounds, { ...listening, visible: false })
    ).toBeNull()
  })
})
