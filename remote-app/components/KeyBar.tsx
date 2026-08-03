import React, { useRef, useState } from "react"

interface KeyBarProps {
  onKey: (combo: string) => void
  onText: (text: string) => void
}

/** Held down until the next key, then cleared. */
const MODIFIERS = ["cmd", "ctrl", "alt", "shift"] as const
type Modifier = (typeof MODIFIERS)[number]

const MODIFIER_LABELS: Record<Modifier, string> = {
  cmd: "⌘",
  ctrl: "Ctrl",
  alt: "⌥",
  shift: "⇧"
}

/** The keys a soft keyboard either lacks or swallows. */
const KEYS: { label: string; combo: string }[] = [
  { label: "Esc", combo: "escape" },
  { label: "Tab", combo: "tab" },
  { label: "↵", combo: "enter" },
  { label: "⌫", combo: "backspace" },
  { label: "←", combo: "left" },
  { label: "↓", combo: "down" },
  { label: "↑", combo: "up" },
  { label: "→", combo: "right" }
]

/**
 * Text entry and the keys a touch keyboard cannot reach.
 *
 * Typing goes through a hidden input rather than by synthesising keystrokes
 * from an on-screen keyboard: Android's own keyboard handles autocorrect,
 * languages, emoji, and voice input, and reimplementing any of that would be
 * worse in every case. What it cannot do is Escape, Tab, arrows, or a modifier
 * chord, so those get real buttons.
 *
 * Modifiers are sticky — tap ⌘, then a key — because there is no chording on a
 * touchscreen and holding two buttons at once is not a gesture phones support.
 */
const KeyBar: React.FC<KeyBarProps> = ({ onKey, onText }) => {
  const [held, setHeld] = useState<Modifier[]>([])
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleModifier = (modifier: Modifier) => {
    setHeld((current) =>
      current.includes(modifier)
        ? current.filter((entry) => entry !== modifier)
        : [...current, modifier]
    )
  }

  const pressKey = (combo: string) => {
    onKey([...held, combo].join("+"))
    setHeld([])
  }

  const sendDraft = () => {
    const text = draft
    if (!text) {
      return
    }
    setDraft("")
    // A held modifier plus typed text means a chord like ⌘+A, not literal
    // text — sending the text would type an "a" into whatever has focus.
    if (held.length === 1 && text.length === 1) {
      onKey([...held, text.toLowerCase()].join("+"))
      setHeld([])
      return
    }
    onText(text)
  }

  return (
    <div className="keybar">
      <div className="keybar-row">
        {MODIFIERS.map((modifier) => (
          <button
            key={modifier}
            type="button"
            className="key key-modifier"
            aria-pressed={held.includes(modifier)}
            onClick={() => toggleModifier(modifier)}
          >
            {MODIFIER_LABELS[modifier]}
          </button>
        ))}
        {KEYS.map((key) => (
          <button
            key={key.combo}
            type="button"
            className="key"
            onClick={() => pressKey(key.combo)}
          >
            {key.label}
          </button>
        ))}
      </div>

      <form
        className="keybar-row"
        onSubmit={(event) => {
          event.preventDefault()
          sendDraft()
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={held.length ? `${held.join("+")}+…` : "Type on the laptop…"}
          aria-label="Text to type on the laptop"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
        />
        <button type="submit" disabled={!draft}>
          Send
        </button>
      </form>
    </div>
  )
}

export default KeyBar
