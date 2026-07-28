import React, { useEffect, useState } from "react"
import {
  Cloud,
  Cpu,
  Download,
  Home,
  Info,
  Keyboard,
  Palette,
  RefreshCw,
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
import { MODES, getModeId, setMode } from "../../lib/modes"
import { SHORTCUTS } from "../../lib/shortcuts"

interface SettingsPanelProps {
  onModelChange?: (provider: "ollama" | "gemini", model: string) => void
  onOpenChat?: () => void
  onModeChange?: (label: string) => void
}

type Tab = "modes" | "provider" | "appearance" | "keybinds" | "about"

/**
 * Offered when no installed local model can read screenshots. Qwen3-VL is
 * GUI-tuned — it grounds interface elements to absolute coordinates, which is
 * the whole job here, and matches the pixel-space prompt the Ollama path uses.
 *
 * The 4B build (~3.3GB) rather than 8B (~6.1GB): a run is up to 25 sequential
 * vision calls, and on fanless Apple Silicon the larger model roughly doubles
 * per-step latency for a modest grounding gain.
 */
const RECOMMENDED_VISION_MODEL = "qwen3-vl:4b"

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "modes", label: "Modes", icon: Wand2 },
  { id: "provider", label: "Provider", icon: Cpu },
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

  // Provider state (ported from ModelsPopover)
  const [selectedProvider, setSelectedProvider] = useState<"ollama" | "gemini">(
    "gemini"
  )
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>(
    []
  )
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("")
  const [visionByModel, setVisionByModel] = useState<Record<string, boolean>>({})
  const [pullProgress, setPullProgress] = useState<{
    status: string
    percent?: number
  } | null>(null)
  const [pullError, setPullError] = useState("")
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [currentLabel, setCurrentLabel] = useState("")
  const [status, setStatus] = useState<"idle" | "working" | "ok" | "err">("idle")
  const [errorMessage, setErrorMessage] = useState("")

  // Appearance
  const [glassTheme, setSelectedGlassTheme] = useState<GlassTheme>(() =>
    getGlassTheme()
  )
  const [glassStrength, setSelectedGlassStrength] = useState<GlassStrength>(() =>
    getGlassStrength()
  )

  // Modes
  const [modeId, setModeId] = useState<string>(() => getModeId())

  const hasVisionModel = Object.values(visionByModel).some(Boolean)

  useEffect(() => {
    void loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const config = await window.electronAPI.getCurrentLlmConfig()
      setSelectedProvider(config.provider)
      setCurrentLabel(`${config.provider} · ${config.model}`)
      if (config.isOllama) {
        setSelectedOllamaModel(config.model)
        await loadOllamaModels()
      }
    } catch (e) {
      console.error(e)
    }
  }

  const loadOllamaModels = async () => {
    try {
      const models = await window.electronAPI.getAvailableOllamaModels()
      setAvailableOllamaModels(models)
      if (models.length > 0 && !selectedOllamaModel) {
        setSelectedOllamaModel(models[0])
      }

      // Teach Me and autopilot both need a model that can read screenshots, so
      // surface that per model rather than letting a run fail later.
      const entries = await Promise.all(
        models.map(async (model) => {
          try {
            const { vision } =
              await window.electronAPI.getOllamaModelCapabilities(model)
            return [model, vision] as const
          } catch {
            return [model, false] as const
          }
        })
      )
      setVisionByModel(Object.fromEntries(entries))
    } catch {
      setAvailableOllamaModels([])
      setVisionByModel({})
    }
  }

  const installVisionModel = async () => {
    setPullError("")
    setPullProgress({ status: "starting", percent: 0 })
    const unsubscribe = window.electronAPI.onOllamaPullProgress((progress) => {
      const percent =
        progress.total && progress.completed
          ? Math.round((progress.completed / progress.total) * 100)
          : undefined
      setPullProgress({ status: progress.status, percent })
    })

    try {
      const result = await window.electronAPI.pullOllamaModel(
        RECOMMENDED_VISION_MODEL
      )
      if (!result.success) {
        setPullError(result.error ?? "The download failed.")
        return
      }
      await loadOllamaModels()
      setSelectedOllamaModel(RECOMMENDED_VISION_MODEL)
    } catch (error) {
      setPullError(String((error as Error)?.message ?? error))
    } finally {
      unsubscribe && unsubscribe()
      setPullProgress(null)
    }
  }

  const apply = async () => {
    try {
      setStatus("working")
      setErrorMessage("")
      let result
      if (selectedProvider === "ollama") {
        result = await window.electronAPI.switchToOllama(
          selectedOllamaModel,
          ollamaUrl
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
          selectedProvider === "ollama" ? selectedOllamaModel : "gemini-3.5-flash"
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
    onModeChange?.(mode.label)
  }

  const ungrouped = MODES.filter((m) => !m.group)
  const groups = Array.from(
    new Set(MODES.filter((m) => m.group).map((m) => m.group as string))
  )

  return (
    <div className="glass-panel-dark panel-enter w-[336px] p-3 no-drag">
      {/* Tab strip */}
      <div className="flex items-center gap-0.5 rounded-lg bg-glass-soft border border-glass p-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={cn(
              "flex-1 flex items-center justify-center rounded-md py-1.5 transition-colors",
              tab === id
                ? "glass-action"
                : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        ))}
      </div>

      <div className="pt-3 space-y-3">
        {tab === "modes" && (
          <>
            <p className="text-[11px] uppercase tracking-wide glass-muted">
              Mode
            </p>
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
                <p className="text-[11px] glass-subtle">{g}</p>
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
            <p className="text-[11px] glass-subtle leading-relaxed">
              A mode changes how the assistant responds. It applies to your next
              message.
            </p>
          </>
        )}

        {tab === "provider" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide glass-muted">
                AI provider
              </p>
              <span className="text-[11px] glass-subtle truncate max-w-[150px]">
                {status === "working"
                  ? "Working…"
                  : status === "ok"
                    ? "Ready"
                    : status === "err"
                      ? errorMessage
                      : currentLabel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-glass-soft border border-glass">
              <button
                type="button"
                onClick={() => setSelectedProvider("gemini")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-colors",
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
                onClick={() => setSelectedProvider("ollama")}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-colors",
                  selectedProvider === "ollama"
                    ? "glass-action"
                    : "glass-muted hover:bg-glass-hover hover:text-glass-heading"
                )}
              >
                <Home className="w-3 h-3" strokeWidth={1.75} />
                Ollama
              </button>
            </div>

            {selectedProvider === "gemini" ? (
              <div className="space-y-1.5">
                <label className="text-[11px] uppercase tracking-wide glass-muted">
                  API key
                </label>
                <input
                  type="password"
                  placeholder="Optional if already set"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="glass-control w-full rounded-lg px-3 py-2 text-[12px]"
                />
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <label className="text-[11px] uppercase tracking-wide glass-muted">
                    Ollama URL
                  </label>
                  <input
                    type="url"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="glass-control w-full rounded-lg px-3 py-2 text-[12px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] uppercase tracking-wide glass-muted">
                      Model
                    </label>
                    <button
                      type="button"
                      onClick={() => void loadOllamaModels()}
                      className="p-1 rounded glass-icon hover:text-glass-heading"
                      title="Refresh"
                    >
                      <RefreshCw className="w-3 h-3" strokeWidth={1.75} />
                    </button>
                  </div>
                  {availableOllamaModels.length > 0 ? (
                    <select
                      value={selectedOllamaModel}
                      onChange={(e) => setSelectedOllamaModel(e.target.value)}
                      className="glass-control w-full rounded-lg px-3 py-2 text-[12px]"
                    >
                      {availableOllamaModels.map((m) => (
                        <option key={m} value={m} className="bg-neutral-900">
                          {m}
                          {visionByModel[m] ? " · sees screen" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[11px] glass-muted">
                      No local models found. Start Ollama and pull a model.
                    </p>
                  )}

                  {selectedOllamaModel &&
                    visionByModel[selectedOllamaModel] === false && (
                      <p className="text-[11px] glass-muted">
                        This model can’t read screenshots, so Teach Me and
                        autopilot won’t work with it.
                      </p>
                    )}

                  {!hasVisionModel && !pullProgress && (
                    <button
                      type="button"
                      onClick={() => void installVisionModel()}
                      className="glass-action flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px]"
                    >
                      <Download className="w-3 h-3" strokeWidth={1.75} />
                      Install {RECOMMENDED_VISION_MODEL}
                    </button>
                  )}

                  {pullProgress && (
                    <div className="space-y-1" role="status">
                      <div className="flex items-center justify-between text-[11px] glass-muted">
                        <span>{pullProgress.status}</span>
                        {pullProgress.percent !== undefined && (
                          <span className="tabular-nums">
                            {pullProgress.percent}%
                          </span>
                        )}
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-glass-soft">
                        <div
                          className="h-full rounded-full bg-white/60 transition-[width]"
                          style={{ width: `${pullProgress.percent ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {pullError && (
                    <p className="text-[11px] glass-text" role="alert">
                      {pullError}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={status === "working"}
                className="glass-action flex-1 min-h-7 rounded-lg py-2 text-[11px] font-medium disabled:opacity-50"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => void test()}
                disabled={status === "working"}
                className="glass-control min-h-7 rounded-lg px-3 py-2 text-[11px] hover:bg-glass-hover disabled:opacity-50"
              >
                Test
              </button>
            </div>
          </>
        )}

        {tab === "appearance" && (
          <>
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wide glass-muted">
                Theme
              </label>
              <span className="text-[11px] glass-subtle capitalize">
                {glassTheme === "royal" ? "Royal blue" : glassTheme}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-glass-soft p-0.5 border border-glass">
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
                    "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-colors",
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
              <label className="text-[11px] uppercase tracking-wide glass-muted">
                Glass strength
              </label>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-glass-soft p-0.5 border border-glass">
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
                      "min-h-7 rounded-md px-1.5 text-[11px] transition-colors",
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
                <span className="text-[11px] glass-muted">{s.action}</span>
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
          <div className="space-y-2 text-[11px] glass-muted">
            <p className="text-[13px] font-semibold glass-heading">Quip</p>
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
      "w-full text-left rounded-lg px-3 py-2 text-[12px] transition-colors",
      active
        ? "glass-action"
        : "glass-control glass-muted hover:bg-glass-hover hover:text-glass-heading"
    )}
  >
    {label}
  </button>
)

export default SettingsPanel
