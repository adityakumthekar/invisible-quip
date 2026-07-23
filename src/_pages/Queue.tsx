import React, { useState, useEffect, useReducer, useRef } from "react"
import { useQuery } from "react-query"
import {
  Toast,
  ToastTitle,
  ToastDescription,
  ToastVariant,
  ToastMessage
} from "../components/ui/toast"
import ControlBar from "../components/shell/ControlBar"
import AIResponse from "../components/shell/AIResponse"
import SettingsPanel from "../components/shell/SettingsPanel"
import QuickActions from "../components/shell/QuickActions"
import TeachingPanel from "../components/teaching/TeachingPanel"
import { applySavedMode } from "../lib/modes"
import {
  executeTeachingOperation,
  initialTeachingSessionState,
  teachingSessionReducer,
  type TeachingOperation
} from "../lib/teachingSession"
import type { PrivacyGateStatus } from "../lib/privacyContract"
import { evaluatePrivacyGate } from "../lib/privacyGate"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions" | "debug">>
}

const Queue: React.FC<QueueProps> = ({ setView }) => {
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<ToastMessage>({
    title: "",
    description: "",
    variant: "neutral"
  })

  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "gemini"; text: string }[]
  >([])
  const [chatLoading, setChatLoading] = useState(false)
  const [panelsOpen, setPanelsOpen] = useState(false)
  const [includeScreen, setIncludeScreen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [teachingOpen, setTeachingOpen] = useState(false)
  const [teachingSession, dispatchTeaching] = useReducer(
    teachingSessionReducer,
    initialTeachingSessionState
  )
  const teachingRequestId = useRef(0)
  const teachingInFlight = useRef(false)
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyGateStatus | null>(null)
  const [privacyChecking, setPrivacyChecking] = useState(false)
  const [privacyError, setPrivacyError] = useState<string | null>(null)

  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [currentModel, setCurrentModel] = useState<{
    provider: "ollama" | "gemini"
    model: string
  }>({ provider: "gemini", model: "gemini-3.5-flash" })

  const { data: screenshots = [], refetch } = useQuery<
    Array<{ path: string; preview: string }>,
    Error
  >(
    ["screenshots"],
    async () => {
      try {
        return await window.electronAPI.getScreenshots()
      } catch (error) {
        console.error("Error loading screenshots:", error)
        showToast("Error", "Failed to load existing screenshots", "error")
        return []
      }
    },
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      refetchOnWindowFocus: true,
      refetchOnMount: true
    }
  )

  const showToast = (
    title: string,
    description: string,
    variant: ToastVariant
  ) => {
    setToastMessage({ title, description, variant })
    setToastOpen(true)
  }

  const openPanels = () => setPanelsOpen(true)

  const sendPrompt = async (
    prompt: string,
    opts?: { silentUser?: boolean; useScreen?: boolean }
  ) => {
    if (!prompt.trim()) return
    if (!opts?.silentUser) {
      setChatMessages((msgs) => [...msgs, { role: "user", text: prompt }])
    }
    setChatLoading(true)
    openPanels()
    try {
      const withScreen = opts?.useScreen ?? includeScreen
      const channel = withScreen ? "chat-with-screen" : "gemini-chat"
      const response = await window.electronAPI.invoke(channel, prompt)
      setChatMessages((msgs) => [...msgs, { role: "gemini", text: response }])
    } catch (err) {
      setChatMessages((msgs) => [
        ...msgs,
        { role: "gemini", text: "Error: " + String(err) }
      ])
    } finally {
      setChatLoading(false)
    }
  }

  const handleChatSend = async () => {
    const prompt = chatInput.trim()
    if (!prompt) return
    setChatInput("")
    await sendPrompt(prompt)
  }

  const handleAskAi = () => {
    openPanels()
  }

  const handleTogglePanels = () => {
    setPanelsOpen((open) => !open)
  }

  const runQuickAction = (prompt: string, useScreen: boolean) => {
    setQuickOpen(false)
    void sendPrompt(prompt, { useScreen })
  }

  const refreshPrivacyStatus = async () => {
    try {
      const status = await window.electronAPI.privacyGetStatus()
      setPrivacyStatus(status)
      setPrivacyError(null)
    } catch (error) {
      setPrivacyError(
        "Couldn't check privacy status. " + String((error as Error)?.message ?? error)
      )
    }
  }

  const acknowledgePrivacy = async () => {
    try {
      const status = await window.electronAPI.privacyAcknowledge()
      setPrivacyStatus(status)
      setPrivacyError(null)
    } catch (error) {
      setPrivacyError(
        "Couldn't save acknowledgement. " + String((error as Error)?.message ?? error)
      )
    }
  }

  const runPrivacyPreflightCheck = async () => {
    setPrivacyChecking(true)
    try {
      await window.electronAPI.privacyRunPreflight()
      await refreshPrivacyStatus()
    } catch (error) {
      setPrivacyError(
        "Privacy check failed to run. " + String((error as Error)?.message ?? error)
      )
    } finally {
      setPrivacyChecking(false)
    }
  }

  const runTeachingOperation = async (operation: TeachingOperation) => {
    if (teachingInFlight.current) return
    const goal = teachingSession.goal.trim()
    if (operation === "start" && !goal) return
    if (
      operation === "start" &&
      (!privacyStatus || !evaluatePrivacyGate(privacyStatus).canStart)
    ) {
      return
    }

    teachingInFlight.current = true
    const requestId = ++teachingRequestId.current
    dispatchTeaching({ type: "request", operation, requestId })

    try {
      const provider =
        operation === "start"
          ? (await window.electronAPI.getCurrentLlmConfig()).provider
          : currentModel.provider
      const outcome = await executeTeachingOperation(
        operation,
        goal,
        provider,
        {
          start: window.electronAPI.teachStart,
          next: window.electronAPI.teachNext
        },
        () => requestId === teachingRequestId.current
      )
      if (outcome.kind === "provider-blocked") {
        dispatchTeaching({ type: "provider-blocked", requestId })
      } else if (outcome.kind === "result") {
        dispatchTeaching({
          type: "resolved",
          requestId,
          result: outcome.result
        })
      }
    } catch (error) {
      dispatchTeaching({ type: "rejected", requestId, error })
    } finally {
      if (requestId === teachingRequestId.current) {
        teachingInFlight.current = false
      }
    }
  }

  const stopTeaching = () => {
    teachingInFlight.current = false
    const requestId = ++teachingRequestId.current
    dispatchTeaching({ type: "reset", requestId })
    setTeachingOpen(false)
    void window.electronAPI.teachStop().catch(() => {
      showToast("Teaching stopped", "The teaching overlay was cleared.", "neutral")
    })
  }

  const toggleTeaching = () => {
    if (teachingOpen) {
      stopTeaching()
    } else {
      setTeachingOpen(true)
      void refreshPrivacyStatus()
    }
  }

  const handleRecordClick = async () => {
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true
        })
        setMicStream(stream)
        const recorder = new MediaRecorder(stream)
        chunks.current = []
        recorder.ondataavailable = (e) => chunks.current.push(e.data)
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          setMicStream(null)
          const blob = new Blob(chunks.current, {
            type: chunks.current[0]?.type || "audio/webm"
          })
          chunks.current = []
          const reader = new FileReader()
          reader.onloadend = async () => {
            const base64Data = (reader.result as string).split(",")[1]
            openPanels()
            setChatLoading(true)
            try {
              const result = await window.electronAPI.analyzeAudioFromBase64(
                base64Data,
                blob.type
              )
              setChatMessages((msgs) => [
                ...msgs,
                { role: "gemini", text: result.text }
              ])
            } catch {
              setChatMessages((msgs) => [
                ...msgs,
                { role: "gemini", text: "Audio analysis failed." }
              ])
            } finally {
              setChatLoading(false)
            }
          }
          reader.readAsDataURL(blob)
        }
        setMediaRecorder(recorder)
        recorder.start()
        setIsRecording(true)
        setRecordingSeconds(0)
      } catch {
        showToast("Error", "Could not start recording.", "error")
      }
    } else {
      mediaRecorder?.stop()
      setIsRecording(false)
      setMediaRecorder(null)
    }
  }

  useEffect(() => {
    if (!isRecording) return
    const id = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [isRecording])

  useEffect(() => {
    const loadCurrentModel = async () => {
      try {
        const config = await window.electronAPI.getCurrentLlmConfig()
        setCurrentModel({ provider: config.provider, model: config.model })
      } catch (error) {
        console.error("Error loading current model config:", error)
      }
    }
    void loadCurrentModel()
    applySavedMode()
  }, [])

  useEffect(() => {
    const updateDimensions = () => {
      if (contentRef.current) {
        let contentHeight = contentRef.current.scrollHeight
        const contentWidth = Math.max(contentRef.current.scrollWidth, 720)
        if (isTooltipVisible) contentHeight += tooltipHeight
        window.electronAPI.updateContentDimensions({
          width: contentWidth,
          height: contentHeight
        })
      }
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (contentRef.current) resizeObserver.observe(contentRef.current)
    updateDimensions()

    const cleanupFunctions = [
      window.electronAPI.onScreenshotTaken(() => refetch()),
      window.electronAPI.onResetView(() => {
        refetch()
        setPanelsOpen(false)
        setChatMessages([])
      }),
      window.electronAPI.onSolutionError(() => {
        showToast(
          "Processing Failed",
          "There was an error processing your screenshots.",
          "error"
        )
        setView("queue")
      }),
      window.electronAPI.onProcessingNoScreenshots(() => {
        showToast(
          "No Screenshots",
          "There are no screenshots to process.",
          "neutral"
        )
      })
    ]

    return () => {
      resizeObserver.disconnect()
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [isTooltipVisible, tooltipHeight, refetch, setView])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      await refetch()
      openPanels()
      setChatLoading(true)
      try {
        const latest =
          data?.path ||
          (Array.isArray(data) &&
            data.length > 0 &&
            data[data.length - 1]?.path)
        if (latest) {
          const response = await window.electronAPI.invoke(
            "analyze-image-file",
            latest
          )
          const text = response.text || String(response)
          setChatMessages((msgs) => [...msgs, { role: "gemini", text }])
        }
      } catch (err) {
        setChatMessages((msgs) => [
          ...msgs,
          { role: "gemini", text: "Error: " + String(err) }
        ])
      } finally {
        setChatLoading(false)
      }
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [refetch])

  const handleModelChange = (provider: "ollama" | "gemini", model: string) => {
    setCurrentModel({ provider, model })
    setChatMessages((msgs) => [
      ...msgs,
      {
        role: "gemini",
        text: `Switched to ${model}. Ready for your questions.`
      }
    ])
  }

  const modelLabel =
    currentModel.provider === "ollama"
      ? currentModel.model
      : "Gemini 3.5 Flash"

  return (
    <div
      ref={contentRef}
      className="select-none relative w-full pointer-events-auto"
    >
      <div className="px-2 py-1 space-y-3">
        <Toast
          open={toastOpen}
          onOpenChange={setToastOpen}
          variant={toastMessage.variant}
          duration={3000}
        >
          <ToastTitle>{toastMessage.title}</ToastTitle>
          <ToastDescription>{toastMessage.description}</ToastDescription>
        </Toast>

        <div className="flex items-start gap-2">
          <ControlBar
            screenshots={screenshots}
            isRecording={isRecording}
            recordingSeconds={recordingSeconds}
            micStream={micStream}
            panelsOpen={panelsOpen}
            modelsOpen={isSettingsOpen}
            quickOpen={quickOpen}
            teachingOpen={teachingOpen}
            onAskAi={handleAskAi}
            onTeachMe={toggleTeaching}
            onTogglePanels={handleTogglePanels}
            onToggleModels={() => setIsSettingsOpen((v) => !v)}
            onToggleQuick={() => setQuickOpen((v) => !v)}
            onRecordClick={() => void handleRecordClick()}
            onTooltipVisibilityChange={(visible, height) => {
              setIsTooltipVisible(visible)
              setTooltipHeight(height)
            }}
          />
          {quickOpen && <QuickActions onRun={runQuickAction} />}
          {isSettingsOpen && (
            <SettingsPanel
              onModelChange={handleModelChange}
              onOpenChat={openPanels}
              onModeChange={(label) =>
                showToast("Mode changed", `Now using ${label} mode`, "neutral")
              }
            />
          )}
        </div>

        {teachingOpen && (
          <TeachingPanel
            session={teachingSession}
            privacy={{
              status: privacyStatus,
              checking: privacyChecking,
              error: privacyError
            }}
            onGoalChange={(goal) =>
              dispatchTeaching({ type: "set-goal", goal })
            }
            onStart={() => void runTeachingOperation("start")}
            onNext={() => void runTeachingOperation("next")}
            onRetry={(operation) => void runTeachingOperation(operation)}
            onStop={stopTeaching}
            onClose={stopTeaching}
            onAcknowledgePrivacy={() => void acknowledgePrivacy()}
            onRunPrivacyCheck={() => void runPrivacyPreflightCheck()}
          />
        )}

        {panelsOpen && (
          <div className="grid grid-cols-1 gap-3 w-[min(560px,100%)]">
            <AIResponse
              messages={chatMessages}
              loading={chatLoading}
              modelLabel={modelLabel}
              input={chatInput}
              includeScreen={includeScreen}
              onInputChange={setChatInput}
              onSend={() => void handleChatSend()}
              onToggleIncludeScreen={() => setIncludeScreen((v) => !v)}
              onClose={() => setPanelsOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default Queue
