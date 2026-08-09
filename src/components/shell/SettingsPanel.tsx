import React, { useEffect, useState } from "react"
import {
  Cloud,
  Cpu,
  Info,
  Keyboard,
  Palette,
  Server,
  ShieldCheck,
  Wand2
} from "lucide-react"
import { cn } from "../../lib/utils"
import {
  GlassStrength,
  GlassTheme,
  getGlassStrength,
  getGlassTheme,
  setGlassStrength,
  setGlassTheme
} from "../../lib/glassTheme"
import { MODES, getModeId, setMode, type Mode } from "../../lib/modes"
import { SHORTCUTS } from "../../lib/shortcuts"
import type { AutonomyLevel } from "../../lib/autopilot"

type ProviderId = "gemini" | "qwen"

/**
 * ipcRenderer.invoke wraps a main-process throw as
 * "Error invoking remote method 'x': Error: <the actual message>". Only the
 * tail is worth showing next to a control the user just clicked.
 */
function unwrapIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(
    /^Error invoking remote method '[^']*':\s*(Error:\s*)?/,
    ""
  )
}

/**
 * How much autopilot may do before asking. Copy is deliberately concrete about
 * what each level gives up — "hands-off" in particular removes the gates that
 * stop a run inside a terminal or System Settings.
 */
const AUTONOMY_OPTIONS: {
  id: AutonomyLevel
  label: string
  detail: string
}[] = [
  {
    id: "guarded",
    label: "Guarded",
    detail: "Asks before anything but clicking and scrolling."
  },
  {
    id: "balanced",
    label: "Balanced",
    detail:
      "Types and clicks on its own. Asks before sending, deleting, paying, or typing a credential — and in terminals, system settings, and messaging apps."
  },
  {
    id: "handsoff",
    label: "Hands-off",
    detail:
      "As Balanced, but keeps going in terminals, system settings, and messaging apps too."
  }
]

interface SettingsPanelProps {
  onModelChange?: (provider: ProviderId, model: string) => void
  onOpenChat?: () => void
  // The whole mode, not just its label: the shell sizes the answer panel from
  // it (see Mode.panelWidth).
  onModeChange?: (mode: Mode) => void
}

type Tab =
  "modes" | "provider" | "autopilot" | "appearance" | "keybinds" | "about"

type Status = "idle" | "working" | "ok" | "err"

/**
 * Outcome had no colour at all — "Ready" and a connection failure rendered in
 * the same grey, truncated to 150px, next to the button that had just run.
 */
const STATUS_TONE: Record<Status, string> = {
  idle: "glass-subtle",
  working: "glass-subtle",
  ok: "text-glass-success",
  err: "text-glass-danger"
}

const DEFAULT_QWEN_BASE_URL = "http://100.123.38.63:8000/v1"
const DEFAULT_QWEN_MODEL = "Qwen/Qwen3-VL-4B-Instruct"

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "modes", label: "Modes", icon: Wand2 },
  { id: "provider", label: "Provider", icon: Cpu },
  // Autonomy decides whether Quip will act inside a terminal without asking.
  // It used to live at the bottom of the Provider tab, under the vLLM base URL
  // and the API key — a safety control filed under hardware config.
  { id: "autopilot", label: "Autopilot", icon: ShieldCheck },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keybinds", label: "Keybinds", icon: Keyboard },
  { id: "about", label: "About", icon: Info }
]

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  onModelChange,
  onOpenChat,
  onModeChange
}) => {
  const [tab, setTab] = useState<Tab>("modes")

  const [selectedProvider, setSelectedProvider] = useState<ProviderId>("gemini")
  const [qwenBaseUrl, setQwenBaseUrl] = useState(DEFAULT_QWEN_BASE_URL)
  const [qwenModel, setQwenModel] = useState(DEFAULT_QWEN_MODEL)
  const [qwenApiKey, setQwenApiKey] = useState("EMPTY")
  const [qwenModelOptions, setQwenModelOptions] = useState<string[]>([])
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [autonomy, setAutonomy] = useState<AutonomyLevel>("balanced")
  const [autonomyError, setAutonomyError] = useState("")
  const [currentLabel, setCurrentLabel] = useState("")
  const [status, setStatus] = useState<"idle" | "working" | "ok" | "err">(
    "idle"
  )
  const [errorMessage, setErrorMessage] = useState("")

  // Appearance
  const [glassTheme, setSelectedGlassTheme] = useState<GlassTheme>(() =>
    getGlassTheme()
  )
  const [glassStrength, setSelectedGlassStrength] = useState<GlassStrength>(
    () => getGlassStrength()
  )

  // Modes
  const [modeId, setModeId] = useState<string>(() => getModeId())

  useEffect(() => {
    void loadConfig()
    void loadAutonomy()
  }, [])

  const loadConfig = async () => {
    try {
      const config = await window.electronAPI.getCurrentLlmConfig()
      const provider: ProviderId =
        config.provider === "qwen" ? "qwen" : "gemini"
      setSelectedProvider(provider)
      setCurrentLabel(`${provider} · ${config.model}`)
      if (config.isQwen || config.provider === "qwen") {
        setQwenModel(config.model || DEFAULT_QWEN_MODEL)
        if (config.qwenBaseUrl) {
          setQwenBaseUrl(config.qwenBaseUrl)
          void refreshQwenModels(config.qwenBaseUrl)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const loadAutonomy = async () => {
    try {
      const current = await window.electronAPI.autopilotGetAutonomy()
      setAutonomy(current.level)
    } catch (e) {
      console.error(e)
    }
  }

  const changeAutonomy = async (level: AutonomyLevel) => {
    // Optimistic, then reconciled: main rejects a change while a run is in
    // flight, and the error is the only way the user learns why.
    const previous = autonomy
    setAutonomy(level)
    setAutonomyError("")
    try {
      const saved = await window.electronAPI.autopilotSetAutonomy(level)
      setAutonomy(saved.level)
    } catch (e) {
      setAutonomy(previous)
      setAutonomyError(unwrapIpcError(e))
    }
  }

  /**
   * Ask the endpoint what it serves. An empty list is the normal answer for a
   * server without /models, and leaves the free-text field in place.
   */
  const refreshQwenModels = async (baseUrl: string) => {
    if (!baseUrl.trim()) return
    try {
      const models = await window.electronAPI.listQwenModels(
        baseUrl,
        qwenApiKey || "EMPTY"
      )
      setQwenModelOptions(models)
      // Only adopt the server's answer when what's selected isn't on offer.
      if (models.length > 0 && !models.includes(qwenModel)) {
        setQwenModel(models[0])
      }
    } catch (e) {
      console.error(e)
      setQwenModelOptions([])
    }
  }

  const apply = async () => {
    try {
      setStatus("working")
      setErrorMessage("")
      let result
      if (selectedProvider === "qwen") {
        result = await window.electronAPI.switchToQwen(
          qwenBaseUrl,
          qwenModel,
          qwenApiKey || "EMPTY"
        )
      } else {
        result = await window.electronAPI.switchToGemini(
          geminiApiKey || undefined
        )
      }
      if (result.success) {
        await loadConfig()
        setStatus("ok")
        onModelChange?.(
          selectedProvider,
          selectedProvider === "qwen" ? qwenModel : "gemini-3.6-flash"
        )
        onOpenChat?.()
      } else {
        setStatus("err")
        setErrorMessage(result.error || "Switch failed")
      }
    } catch (e) {
      setStatus("err")
      setErrorMessage(String(e))
    }
  }

  const test = async () => {
    try {
      setStatus("working")
      const result = await window.electronAPI.testLlmConnection()
      setStatus(result.success ? "ok" : "err")
      if (!result.success) setErrorMessage(result.error || "Connection failed")
    } catch (e) {
      setStatus("err")
      setErrorMessage(String(e))
    }
  }

  const chooseMode = (id: string) => {
    const mode = setMode(id)
    setModeId(mode.id)
    onModeChange?.(mode)
  }

  const ungrouped = MODES.filter((m) => !m.group)
  const groups = Array.from(
    new Set(MODES.filter((m) => m.group).map((m) => m.group as string))
  )

  return (
    <div className="glass-panel-dark panel-enter w-[336px] p-3 no-drag">
      {/* Tab strip. Icon-only to keep the panel at 336px, which is exactly why
          the open section's name is spelled out underneath — before, `title`
          was the only place any of these six words appeared. */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex items-center gap-0.5 rounded-nested bg-glass-soft border border-glass p-0.5"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-controls="settings-tabpanel"
            aria-selected={tab === id}
            aria-label={label}
            title={label}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center rounded-inner py-1.5 transition-colors",
              tab === id
                ? "glass-action"
                : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-2 pt-3">
        <p className="text-meta uppercase tracking-wide glass-muted">
          {TABS.find((t) => t.id === tab)?.label}
        </p>
        {tab === "provider" && (
          <span
            role={status === "err" ? "alert" : "status"}
            title={status === "err" ? errorMessage : undefined}
            className={cn(
              "text-meta truncate max-w-[170px]",
              STATUS_TONE[status]
            )}
          >
            {status === "working"
              ? "Working…"
              : status === "ok"
                ? "Ready"
                : status === "err"
                  ? errorMessage
                  : currentLabel}
          </span>
        )}
      </div>

      <div
        id="settings-tabpanel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="pt-2 space-y-3"
      >
        {tab === "modes" && (
          <>
            <div className="grid grid-cols-1 gap-1">
              {ungrouped.map((m) => (
                <ModeRow
                  key={m.id}
                  active={modeId === m.id}
                  label={m.label}
                  onClick={() => chooseMode(m.id)}
                />
              ))}
            </div>
            {groups.map((g) => (
              <div key={g} className="space-y-1">
                <p className="text-meta glass-subtle">{g}</p>
                {MODES.filter((m) => m.group === g).map((m) => (
                  <ModeRow
                    key={m.id}
                    active={modeId === m.id}
                    label={m.label}
                    onClick={() => chooseMode(m.id)}
                  />
                ))}
              </div>
            ))}
            <p className="text-meta glass-subtle leading-relaxed">
              A mode changes how the assistant responds. It applies to your next
              message.
            </p>
          </>
        )}

        {tab === "provider" && (
          <>
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-nested bg-glass-soft border border-glass">
              <button
                type="button"
                onClick={() => setSelectedProvider("gemini")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-inner py-1.5 text-meta transition-colors",
                  selectedProvider === "gemini"
                    ? "glass-action"
                    : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
                )}
              >
                <Cloud className="w-3 h-3" strokeWidth={1.75} />
                Gemini
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("qwen")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-inner py-1.5 text-meta transition-colors",
                  selectedProvider === "qwen"
                    ? "glass-action"
                    : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
                )}
              >
                <Server className="w-3 h-3" strokeWidth={1.75} />
                Qwen
              </button>
            </div>

            {selectedProvider === "gemini" ? (
              <div className="space-y-1.5">
                <label className="text-meta uppercase tracking-wide glass-muted">
                  API key
                </label>
                <input
                  type="password"
                  placeholder="Optional if already set"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="glass-control w-full rounded-nested px-3 py-2 text-body"
                />
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <label className="text-meta uppercase tracking-wide glass-muted">
                    vLLM base URL
                  </label>
                  <input
                    type="url"
                    value={qwenBaseUrl}
                    onChange={(e) => setQwenBaseUrl(e.target.value)}
                    onBlur={(e) => void refreshQwenModels(e.target.value)}
                    placeholder={DEFAULT_QWEN_BASE_URL}
                    className="glass-control w-full rounded-nested px-3 py-2 text-body"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="qwen-model"
                      className="text-meta uppercase tracking-wide glass-muted"
                    >
                      Model
                    </label>
                    <button
                      type="button"
                      onClick={() => void refreshQwenModels(qwenBaseUrl)}
                      className="text-meta glass-subtle hover:text-glass-heading"
                    >
                      Refresh
                    </button>
                  </div>
                  {/* A server without /models answers with nothing; typing the
                      id by hand stays possible in that case. */}
                  {qwenModelOptions.length > 0 ? (
                    <select
                      id="qwen-model"
                      value={qwenModel}
                      onChange={(e) => setQwenModel(e.target.value)}
                      className="glass-control w-full rounded-nested px-3 py-2 text-body"
                    >
                      {qwenModelOptions.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="qwen-model"
                      type="text"
                      value={qwenModel}
                      onChange={(e) => setQwenModel(e.target.value)}
                      placeholder={DEFAULT_QWEN_MODEL}
                      className="glass-control w-full rounded-nested px-3 py-2 text-body"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-meta uppercase tracking-wide glass-muted">
                    API key
                  </label>
                  <input
                    type="password"
                    value={qwenApiKey}
                    onChange={(e) => setQwenApiKey(e.target.value)}
                    placeholder="EMPTY"
                    className="glass-control w-full rounded-nested px-3 py-2 text-body"
                  />
                  <p className="text-meta glass-subtle leading-relaxed">
                    Remote Qwen3-VL via OpenAI-compatible vLLM. Sees the screen
                    for chat, Teach Me, and autopilot.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={status === "working"}
                className="glass-action flex-1 min-h-7 rounded-nested py-2 text-meta font-medium disabled:opacity-50"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => void test()}
                disabled={status === "working"}
                title="Send a probe request to the selected provider"
                className="glass-control min-h-7 rounded-nested px-3 py-2 text-meta hover:bg-glass-hover disabled:opacity-50"
              >
                Test
              </button>
            </div>
          </>
        )}

        {tab === "autopilot" && (
          <>
            <div className="space-y-2">
              <p className="text-meta glass-subtle leading-relaxed">
                How much autopilot may do before it stops and asks you.
              </p>
              <div className="space-y-1">
                {AUTONOMY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => void changeAutonomy(option.id)}
                    aria-pressed={autonomy === option.id}
                    className={cn(
                      "w-full rounded-nested px-3 py-2 text-left transition-colors",
                      autonomy === option.id
                        ? "glass-action"
                        : "glass-control hover:bg-glass-hover"
                    )}
                  >
                    <span className="block text-label font-medium">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-meta leading-relaxed glass-subtle">
                      {option.detail}
                    </span>
                  </button>
                ))}
              </div>
              {autonomyError && (
                <p
                  className="text-meta leading-relaxed text-glass-danger"
                  role="alert"
                >
                  {autonomyError}
                </p>
              )}
            </div>
          </>
        )}

        {tab === "appearance" && (
          <>
            <div className="flex items-center justify-between">
              <label className="text-meta uppercase tracking-wide glass-muted">
                Theme
              </label>
              <span className="text-meta glass-subtle capitalize">
                {glassTheme === "royal" ? "Royal blue" : glassTheme}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-nested bg-glass-soft p-0.5 border border-glass">
              {(
                [
                  ["neutral", "Neutral"],
                  ["royal", "Royal"],
                  ["purple", "Purple"]
                ] as const
              ).map(([theme, label]) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => {
                    setSelectedGlassTheme(theme)
                    setGlassTheme(theme)
                  }}
                  aria-pressed={glassTheme === theme}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-inner py-1.5 text-meta transition-colors",
                    glassTheme === theme
                      ? "glass-action"
                      : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
                  )}
                >
                  <span className={`theme-swatch theme-swatch-${theme}`} />
                  {label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <label className="text-meta uppercase tracking-wide glass-muted">
                Glass strength
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-nested bg-glass-soft p-0.5 border border-glass">
                {(
                  [
                    ["clear", "Clear"],
                    ["balanced", "Balanced"],
                    ["solid", "Solid"]
                  ] as const
                ).map(([strength, label]) => (
                  <button
                    key={strength}
                    type="button"
                    onClick={() => {
                      setSelectedGlassStrength(strength)
                      setGlassStrength(strength)
                    }}
                    aria-pressed={glassStrength === strength}
                    className={cn(
                      "min-h-7 rounded-inner px-1.5 text-meta transition-colors",
                      glassStrength === strength
                        ? "glass-action"
                        : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "keybinds" && (
          <div className="space-y-2">
            {SHORTCUTS.map((s) => (
              <div
                key={s.action}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-meta glass-muted">{s.action}</span>
                <span className="flex gap-1">
                  {s.keys.map((k, i) => (
                    <span key={i} className="kbd">
                      {k}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === "about" && (
          <div className="space-y-2 text-meta glass-muted">
            <p className="text-title font-semibold glass-heading">Quip</p>
            <p className="leading-relaxed">
              An invisible, always-on-top AI assistant — real-time answers,
              screenshot analysis, and audio insights.
            </p>
            <div className="flex items-center justify-between">
              <span>Provider</span>
              <span className="glass-text truncate max-w-[160px]">
                {currentLabel || "—"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const ModeRow: React.FC<{
  active: boolean
  label: string
  onClick: () => void
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      "w-full text-left rounded-nested px-3 py-2 text-body transition-colors",
      active
        ? "glass-action"
        : "glass-control glass-muted hover:bg-glass-hover hover:text-glass-heading"
    )}
  >
    {label}
  </button>
)

export default SettingsPanel
