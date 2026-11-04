import React, { useEffect, useRef, useState } from "react"
import {
  Cloud,
  Cpu,
  Server,
  Download,
  Home,
  Info,
  Keyboard,
  Palette,
  RefreshCw,
  Headphones,
  Smartphone,
  User,
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
import { PROFILE_MAX_CHARS, getProfile, setProfile } from "../../lib/userProfile"
import RemotePanel from "./RemotePanel"
import SystemAudioPanel from "./SystemAudioPanel"

type Provider = "ollama" | "gemini" | "bedrock"

interface SettingsPanelProps {
  onModelChange?: (provider: Provider, model: string) => void
  onOpenChat?: () => void
  // The whole mode, not just its label: the shell sizes the answer panel from
  // it (see Mode.panelWidth).
  onModeChange?: (mode: Mode) => void
}

type Tab =
  | "modes"
  | "profile"
  | "provider"
  | "remote"
  | "audio"
  | "appearance"
  | "keybinds"
  | "about"

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
  { id: "profile", label: "Profile", icon: User },
  { id: "provider", label: "Provider", icon: Cpu },
  { id: "remote", label: "Remote", icon: Smartphone },
  { id: "audio", label: "Audio", icon: Headphones },
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
  const [selectedProvider, setSelectedProvider] = useState<Provider>("gemini")
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
  // Blank Bedrock fields keep what main already has (env or last apply).
  const [bedrockApiKey, setBedrockApiKey] = useState("")
  const [bedrockRegion, setBedrockRegion] = useState("")
  const [bedrockModelId, setBedrockModelId] = useState("")
  const [sarvamApiKey, setSarvamApiKey] = useState("")
  const [groqApiKey, setGroqApiKey] = useState("")
  // Which service turns a voice clip into text before Claude answers it.
  const [sttProvider, setSttProvider] = useState<"sarvam" | "groq">("sarvam")
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

  // Profile
  const [profile, setProfileText] = useState<string>(() => getProfile())
  const profileTimer = useRef<ReturnType<typeof setTimeout>>()

  const hasVisionModel = Object.values(visionByModel).some(Boolean)

  useEffect(() => {
    void loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const config = await window.electronAPI.getCurrentLlmConfig()
      setSelectedProvider(config.provider)
      if (config.stt) setSttProvider(config.stt)
      setCurrentLabel(`${config.model} on ${config.provider}`)
      if (config.isOllama) {
        setSelectedOllamaModel(config.model)
        await loadOllamaModels()
      }
      return config
    } catch (e) {
      console.error(e)
      return null
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
      } else if (selectedProvider === "bedrock") {
        result = await window.electronAPI.switchToBedrock({
          apiKey: bedrockApiKey || undefined,
          region: bedrockRegion || undefined,
          modelId: bedrockModelId || undefined,
          sarvamApiKey: sarvamApiKey || undefined,
          groqApiKey: groqApiKey || undefined,
          sttProvider
        })
      } else {
        result = await window.electronAPI.switchToGemini(
          geminiApiKey || undefined
        )
      }
      if (result.success) {
        const config = await loadConfig()
        setStatus("ok")
        onModelChange?.(selectedProvider, config?.model ?? "")
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

  useEffect(() => () => clearTimeout(profileTimer.current), [])

  // No Apply button: the Modes tab already applies on click, and a profile you
  // forgot to save is a profile the model never sees. Debounced so a paragraph
  // of typing isn't one IPC round-trip per keystroke.
  const editProfile = (text: string) => {
    const clamped = text.slice(0, PROFILE_MAX_CHARS)
    setProfileText(clamped)
    clearTimeout(profileTimer.current)
    profileTimer.current = setTimeout(() => setProfile(clamped), 400)
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
    <div className="glass-panel-dark panel-enter flex w-[456px] gap-1 p-1.5 no-drag">
      {/* Eight destinations earn a rail: with labels, a tab says what it holds
          instead of asking you to decode its icon. */}
      <nav
        aria-label="Settings sections"
        className="flex w-[116px] shrink-0 flex-col gap-0.5 border-r border-glass pr-1.5"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className="rail-option flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px]"
          >
            <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-3 px-2 py-1.5">
        {tab === "modes" && (
          <>
            <p className="label">
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

        {tab === "profile" && (
          <>
            <div className="flex items-center justify-between">
              <p className="label">
                About you
              </p>
              <span className="text-[11px] glass-subtle tabular-nums">
                {profile.length}/{PROFILE_MAX_CHARS}
              </span>
            </div>
            <textarea
              rows={5}
              value={profile}
              onChange={(e) => editProfile(e.target.value)}
              placeholder="Senior backend engineer, 7 yrs. Go, Postgres, Kafka, k8s on AWS. Interviewing at Stripe for payments infra."
              className="glass-control w-full resize-none rounded-lg px-3 py-2 text-[12px] leading-[1.5]"
            />
            <p className="text-[11px] glass-subtle leading-relaxed">
              Sent with every question so answers land at your level and in your
              stack. Saves as you type.
            </p>
          </>
        )}

        {tab === "provider" && (
          <>
            <div className="flex items-center justify-between">
              <p className="label">
                AI provider
              </p>
              <span
                className={cn(
                  "readout glass-badge truncate max-w-[170px]",
                  status === "err" && "glass-danger-text"
                )}
                role="status"
              >
                {status === "working"
                  ? "Working…"
                  : status === "ok"
                    ? "Ready"
                    : status === "err"
                      ? errorMessage
                      : currentLabel}
              </span>
            </div>
            <div className="glass-well grid grid-cols-3 gap-0.5 p-0.5">
              <button
                type="button"
                onClick={() => setSelectedProvider("gemini")}
                aria-pressed={selectedProvider === "gemini"}
                className="seg-option flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11.5px]"
              >
                <Cloud className="w-3 h-3" strokeWidth={1.75} />
                Gemini
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("ollama")}
                aria-pressed={selectedProvider === "ollama"}
                className="seg-option flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11.5px]"
              >
                <Home className="w-3 h-3" strokeWidth={1.75} />
                Ollama
              </button>
              <button
                type="button"
                onClick={() => setSelectedProvider("bedrock")}
                aria-pressed={selectedProvider === "bedrock"}
                className="seg-option flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11.5px]"
              >
                <Server className="w-3 h-3" strokeWidth={1.75} />
                Bedrock
              </button>
            </div>

            {selectedProvider === "bedrock" ? (
              <div className="space-y-2.5">
                {(
                  [
                    ["Bedrock API key", "password", "Optional if already set", bedrockApiKey, setBedrockApiKey],
                    ["Region", "text", "ap-south-1", bedrockRegion, setBedrockRegion],
                    ["Claude model ID", "text", "Inference profile ID from the console", bedrockModelId, setBedrockModelId],
                    ["Sarvam key (voice)", "password", "Optional if already set", sarvamApiKey, setSarvamApiKey],
                    ["Groq key (voice)", "password", "Optional if already set", groqApiKey, setGroqApiKey]
                  ] as const
                ).map(([label, type, placeholder, value, setValue]) => (
                  <div key={label} className="space-y-1">
                    <label className="label" htmlFor={`bedrock-${label}`}>
                      {label}
                    </label>
                    <input
                      id={`bedrock-${label}`}
                      type={type}
                      placeholder={placeholder}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      className="glass-control w-full rounded-lg px-3 py-2 text-[12px]"
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <label className="label">
                    Voice transcription
                  </label>
                  <select
                    value={sttProvider}
                    onChange={(e) => setSttProvider(e.target.value as "sarvam" | "groq")}
                    className="glass-control w-full rounded-lg px-3 py-2 text-[12px]"
                  >
                    <option value="sarvam">
                      Sarvam (best for Indian English)
                    </option>
                    <option value="groq">
                      Groq Whisper (no 30 s limit)
                    </option>
                  </select>
                </div>
              </div>
            ) : selectedProvider === "gemini" ? (
              <div className="space-y-1.5">
                <label className="label">
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
                  <label className="label">
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
                    <label className="label">
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
                        <option key={m} value={m}>
                          {m}
                          {visionByModel[m] ? " (sees screen)" : ""}
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
                      className="glass-action flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[11.5px]"
                    >
                      <Download className="w-3 h-3" strokeWidth={1.75} />
                      Install {RECOMMENDED_VISION_MODEL}
                    </button>
                  )}

                  {pullProgress && (
                    <div className="space-y-1" role="status">
                      <div className="readout flex items-center justify-between">
                        <span>{pullProgress.status}</span>
                        {pullProgress.percent !== undefined && (
                          <span>{pullProgress.percent}%</span>
                        )}
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            transform: `scaleX(${(pullProgress.percent ?? 0) / 100})`
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {pullError && (
                    <p className="text-[11.5px] glass-danger-text" role="alert">
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
                aria-busy={status === "working"}
                className="glass-primary flex-1 min-h-8 rounded-full py-1.5 text-[12px] lowercase"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => void test()}
                disabled={status === "working"}
                className="glass-action min-h-8 rounded-full px-4 py-1.5 text-[12px] lowercase"
              >
                Test
              </button>
            </div>
          </>
        )}

        {tab === "appearance" && (
          <>
            <div className="flex items-center justify-between">
              <label className="label">
                Theme
              </label>
              <span className="readout capitalize">
                {glassTheme === "royal" ? "Royal blue" : glassTheme}
              </span>
            </div>
            <div className="glass-well grid grid-cols-3 gap-0.5 p-0.5">
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
                  className="seg-option flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11.5px]"
                >
                  <span className={`theme-swatch theme-swatch-${theme}`} />
                  {label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <label className="label">
                Glass strength
              </label>
              <div className="glass-well grid grid-cols-3 gap-0.5 p-0.5">
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
                    className="seg-option min-h-7 rounded-md px-1.5 text-[11.5px]"
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
                <span className="text-[12px] glass-muted">{s.action}</span>
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

        {tab === "remote" && <RemotePanel />}

        {tab === "audio" && <SystemAudioPanel />}

        {tab === "about" && (
          <div className="space-y-2 text-[12px] glass-muted">
            <h3 className="panel-title">Quip</h3>
            <p className="leading-relaxed">
              An invisible, always-on-top AI assistant: real-time answers,
              screenshot analysis, and audio insights.
            </p>
            <div className="flex items-center justify-between gap-3 border-t border-glass pt-2">
              <span className="label">Provider</span>
              <span className="readout glass-badge truncate max-w-[180px]">
                {currentLabel || "Not set"}
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
    className="rail-option w-full text-left rounded-md px-3 py-1.5 text-[12.5px]"
  >
    {label}
  </button>
)

export default SettingsPanel
