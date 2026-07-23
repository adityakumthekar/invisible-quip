import React, { useEffect, useState } from "react"
import { Cloud, Home, RefreshCw } from "lucide-react"
import { cn } from "../../lib/utils"
import {
  GlassStrength,
  GlassTheme,
  getGlassStrength,
  getGlassTheme,
  setGlassStrength,
  setGlassTheme
} from "../../lib/glassTheme"

interface ModelsPopoverProps {
  onModelChange?: (provider: "ollama" | "gemini", model: string) => void
  onOpenChat?: () => void
}

const ModelsPopover: React.FC<ModelsPopoverProps> = ({
  onModelChange,
  onOpenChat
}) => {
  const [selectedProvider, setSelectedProvider] = useState<"ollama" | "gemini">(
    "gemini"
  )
  const [availableOllamaModels, setAvailableOllamaModels] = useState<string[]>(
    []
  )
  const [selectedOllamaModel, setSelectedOllamaModel] = useState("")
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434")
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [currentLabel, setCurrentLabel] = useState("")
  const [status, setStatus] = useState<"idle" | "working" | "ok" | "err">("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [glassTheme, setSelectedGlassTheme] = useState<GlassTheme>(() =>
    getGlassTheme()
  )
  const [glassStrength, setSelectedGlassStrength] = useState<GlassStrength>(() =>
    getGlassStrength()
  )

  useEffect(() => {
    void loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const config = await window.electronAPI.getCurrentLlmConfig()
      setSelectedProvider(config.provider)
      setCurrentLabel(`${config.provider} · ${config.model}`)
      if (config.isOllama) {
        setSelectedOllamaModel(config.model)
        await loadOllamaModels()
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const loadOllamaModels = async () => {
    try {
      const models = await window.electronAPI.getAvailableOllamaModels()
      setAvailableOllamaModels(models)
      if (models.length > 0 && !selectedOllamaModel) {
        setSelectedOllamaModel(models[0])
      }
    } catch {
      setAvailableOllamaModels([])
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
          selectedProvider === "ollama"
            ? selectedOllamaModel
            : "gemini-3.5-flash"
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

  const selectGlassTheme = (theme: GlassTheme) => {
    setSelectedGlassTheme(theme)
    setGlassTheme(theme)
  }

  const selectGlassStrength = (strength: GlassStrength) => {
    setSelectedGlassStrength(strength)
    setGlassStrength(strength)
  }

  if (loading) {
    return (
      <div className="glass-panel-dark panel-enter w-[320px] p-4 text-xs glass-muted">
        Loading models…
      </div>
    )
  }

  return (
    <div className="glass-panel-dark panel-enter w-[320px] p-4 space-y-3.5 no-drag">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold glass-heading">Models</h3>
        <span className="text-[10px] glass-muted truncate max-w-[160px]">
          {status === "working"
            ? "Working…"
            : status === "ok"
              ? "Ready"
              : status === "err"
                ? errorMessage
                : currentLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-white/5 border border-white/10">
        <button
          type="button"
          onClick={() => setSelectedProvider("gemini")}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] transition-colors",
            selectedProvider === "gemini"
              ? "glass-action"
              : "glass-muted hover:bg-white/10 hover:text-white"
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
              : "glass-muted hover:bg-white/10 hover:text-white"
          )}
        >
          <Home className="w-3 h-3" strokeWidth={1.75} />
          Ollama
        </button>
      </div>

      {selectedProvider === "gemini" ? (
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wide glass-muted">
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
            <label className="text-[10px] uppercase tracking-wide glass-muted">
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
              <label className="text-[10px] uppercase tracking-wide glass-muted">
                Model
              </label>
              <button
                type="button"
                onClick={() => void loadOllamaModels()}
                className="p-1 rounded glass-icon hover:text-white"
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
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] glass-muted">
                No local models found. Start Ollama and pull a model.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2.5 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wide glass-muted">
            Appearance
          </label>
          <span className="text-[10px] glass-subtle capitalize">
            {glassTheme === "royal" ? "Royal blue" : glassTheme}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-0.5 border border-white/10">
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
              onClick={() => selectGlassTheme(theme)}
              aria-pressed={glassTheme === theme}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] transition-colors",
                glassTheme === theme
                  ? "glass-action"
                  : "glass-muted hover:bg-white/10 hover:text-white"
              )}
            >
              <span className={`theme-swatch theme-swatch-${theme}`} />
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-wide glass-muted">
            Glass strength
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/5 p-0.5 border border-white/10">
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
                onClick={() => selectGlassStrength(strength)}
                aria-pressed={glassStrength === strength}
                className={cn(
                  "min-h-7 rounded-md px-1.5 text-[10px] transition-colors",
                  glassStrength === strength
                    ? "glass-action"
                    : "glass-muted hover:bg-white/10 hover:text-white"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
          className="glass-control min-h-7 rounded-lg px-3 py-2 text-[11px] hover:bg-white/15 disabled:opacity-50"
        >
          Test
        </button>
      </div>
    </div>
  )
}

export default ModelsPopover
