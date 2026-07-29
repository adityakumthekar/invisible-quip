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
import TeachingPanel, {
  type TeachingMode
} from "../components/teaching/TeachingPanel"
import { DEFAULT_PANEL_WIDTH, applySavedMode, getMode } from "../lib/modes"
import { streamChat } from "../lib/chatStream"
import {
  createMessage,
  toHistory,
  type ChatMessage,
  type ChatSource
} from "../lib/chatMessages"
import {
  executeTeachingOperation,
  initialTeachingSessionState,
  teachingSessionReducer,
  type TeachingOperation
} from "../lib/teachingSession"
import {
  autopilotSessionReducer,
  initialAutopilotSessionState,
  isAutopilotBusy
} from "../lib/autopilotSession"
import type { PrivacyGateStatus } from "../lib/privacyContract"
import type { AutopilotConsent } from "../types/electron"
import { evaluatePrivacyGate } from "../lib/privacyGate"

interface QueueProps {
  setView: React.Dispatch<React.SetStateAction<"queue" | "solutions">>
}

// What Cmd+Enter asks when the input is empty. Phrased to get oriented context
// plus one concrete next step, rather than a bare description of the screen.
// Empty-box Cmd+Enter. It used to always narrate ("what's going on… best next
// action"), which on a coding problem produced coaching instead of the answer —
// so a question on screen is now answered outright, and only a screen with no
// question falls back to the narration.
const SCREEN_GLANCE_PROMPT =
  "Look at my screen. If there is a question, problem, or exercise on screen, " +
  "answer it directly — for a coding problem, give the working solution as code. " +
  "Only if there is no question, say what's going on in a line and the single " +
  "best next action I could take."

// streamChat rejects with a DOMException named AbortError when the caller
// cancels. That is our own doing, not an error worth showing the user.
const isAbortError = (err: unknown) => (err as Error)?.name === "AbortError"

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  // recorder.onstop and the stream callbacks are created once per request and
  // would otherwise close over the transcript as it looked back then.
  const chatMessagesRef = useRef<ChatMessage[]>([])
  chatMessagesRef.current = chatMessages
  // Bumped by every "new chat". Async work captures the epoch it started under
  // and drops its writes if it no longer matches — otherwise an answer to the
  // old conversation lands in the fresh one, and replaceLastMessage below would
  // overwrite whatever turn happened to be last.
  const chatEpochRef = useRef(0)
  // The in-flight streaming request, so a new chat can cancel it in main rather
  // than paying for tokens nobody will read.
  const chatAbortRef = useRef<AbortController | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [panelsOpen, setPanelsOpen] = useState(false)
  // Tracked here only for the panel width — the prompt itself lives in main.
  const [mode, setActiveMode] = useState(getMode)
  const [includeScreen, setIncludeScreen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [teachingOpen, setTeachingOpen] = useState(false)
  const [teachingSession, dispatchTeaching] = useReducer(
    teachingSessionReducer,
    initialTeachingSessionState
  )
  const teachingRequestId = useRef(0)
  const teachingInFlight = useRef(false)
  // Latest-value refs so the global-hotkey listener (subscribed once) always
  // sees the current teaching state and handlers.
  const runTeachingOperationRef = useRef<(op: TeachingOperation) => void>(
    () => {}
  )
  const stopTeachingRef = useRef<() => void>(() => {})
  const teachingPhaseRef = useRef(teachingSession.phase)
  const teachingOpenRef = useRef(teachingOpen)
  const handleAskAiRef = useRef<() => void>(() => {})
  const handleRecordClickRef = useRef<() => void>(() => {})
  const handleNewChatRef = useRef<() => void>(() => {})
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyGateStatus | null>(null)
  const [privacyChecking, setPrivacyChecking] = useState(false)
  const [privacyError, setPrivacyError] = useState<string | null>(null)

  const [teachingMode, setTeachingMode] = useState<TeachingMode>("guide")
  const [autopilot, dispatchAutopilot] = useReducer(
    autopilotSessionReducer,
    initialAutopilotSessionState
  )
  const [autopilotConsent, setAutopilotConsent] =
    useState<AutopilotConsent | null>(null)
  const [autopilotConsentError, setAutopilotConsentError] = useState<
    string | null
  >(null)
  // Read by the once-subscribed hotkey listener, which must not close over
  // stale autopilot state.
  const autopilotRef = useRef(autopilot)

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

  // Replace the text of the assistant message we appended for this response.
  // Spread the existing message rather than rebuilding it — the id and source
  // are what keep React's identity and the turn's provenance stable while the
  // stream rewrites the body.
  const replaceLastMessage = (text: string) =>
    setChatMessages((msgs) => {
      const next = msgs.slice()
      const last = next[next.length - 1]
      if (!last) return msgs
      next[next.length - 1] = { ...last, text }
      return next
    })

  const sendPrompt = async (
    prompt: string,
    opts?: { silentUser?: boolean; useScreen?: boolean }
  ) => {
    if (!prompt.trim()) return
    const withScreen = opts?.useScreen ?? includeScreen
    const channel = withScreen ? "chat-with-screen-stream" : "gemini-chat-stream"

    // Snapshot before the append below — the turn being sent and its empty
    // placeholder must not appear in the history that accompanies it.
    const history = toHistory(chatMessagesRef.current)

    // A silent prompt (the ⌘↵ screen glance) still gets a user turn, just with
    // no body — the header alone says "Screen", which beats an orphan answer.
    const source: ChatSource = withScreen ? "screen" : "typed"
    setChatMessages((msgs) => [
      ...msgs,
      createMessage({
        role: "user",
        text: opts?.silentUser ? "" : prompt,
        source
      }),
      // The empty placeholder the stream fills in.
      createMessage({ role: "gemini", text: "", source })
    ])
    setChatLoading(true)
    openPanels()
    const epoch = chatEpochRef.current
    const controller = new AbortController()
    chatAbortRef.current = controller
    try {
      await streamChat(window.electronAPI, channel, [prompt, history], {
        signal: controller.signal,
        onText: (text) => {
          if (epoch !== chatEpochRef.current) return
          // Drop the spinner the moment there is something to read — this is
          // what makes the answer feel fast.
          setChatLoading(false)
          replaceLastMessage(text)
        }
      })
    } catch (err) {
      // A cancelled request is not a failure to report: the turn it was writing
      // into is already gone.
      if (epoch !== chatEpochRef.current || isAbortError(err)) return
      replaceLastMessage("Error: " + String(err))
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null
      if (epoch === chatEpochRef.current) setChatLoading(false)
    }
  }

  // Chat-only reset, from the bar button and ⌘N. Deliberately narrower than
  // ⌘R's reset-view: the screenshot queue, mode, teaching panel, and any running
  // recording all survive. Dropping the transcript is the whole point — it is
  // the only thing the model remembers.
  const handleNewChat = () => {
    chatEpochRef.current += 1
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setChatMessages([])
    setChatInput("")
    setChatLoading(false)
    setQuickOpen(false)
    // Fired from the hotkey the window may be hidden or the panel closed, and
    // an invisible reset is indistinguishable from a dead keybinding.
    openPanels()
  }

  const handleChatSend = async () => {
    const prompt = chatInput.trim()
    if (!prompt) return
    setChatInput("")
    await sendPrompt(prompt)
  }

  // Ask AI, from both Cmd+Enter and the bar button — they used to disagree, the
  // button only opening the panel while the shortcut ran a queue consumer that
  // toasted "No Screenshots". Both now capture the screen and analyze it.
  const handleAskAi = () => {
    if (chatLoading) return
    openPanels()
    const typed = chatInput.trim()
    if (typed) {
      setChatInput("")
      void sendPrompt(typed, { useScreen: true })
    } else {
      void sendPrompt(SCREEN_GLANCE_PROMPT, {
        useScreen: true,
        silentUser: true
      })
    }
  }

  // The queued-screenshot solver, which used to be what Cmd+Enter ran.
  const handleSolve = () => {
    void window.electronAPI
      .invoke("process-screenshot-queue")
      .catch((err: unknown) => {
        showToast("Solve failed", String(err), "error")
      })
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
      const outcome = await executeTeachingOperation(
        operation,
        goal,
        {
          start: window.electronAPI.teachStart,
          next: window.electronAPI.teachNext,
          execute: window.electronAPI.teachExecute
        },
        () => requestId === teachingRequestId.current
      )
      if (outcome.kind === "result") {
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
    dispatchAutopilot({ type: "reset" })
    setTeachingOpen(false)
    // teach-stop halts an autopilot run too — both modes share one session.
    void window.electronAPI.teachStop().catch(() => {
      showToast("Teaching stopped", "The teaching overlay was cleared.", "neutral")
    })
  }

  const refreshAutopilotConsent = async () => {
    try {
      setAutopilotConsent(await window.electronAPI.autopilotGetConsent())
      setAutopilotConsentError(null)
    } catch (error) {
      setAutopilotConsentError(
        "Could not read autopilot status. " +
          String((error as Error)?.message ?? error)
      )
    }
  }

  const acceptAutopilotConsent = async () => {
    try {
      setAutopilotConsent(await window.electronAPI.autopilotAcknowledgeConsent())
      setAutopilotConsentError(null)
    } catch (error) {
      setAutopilotConsentError(
        "Could not save your choice. " +
          String((error as Error)?.message ?? error)
      )
    }
  }

  const startAutopilot = async () => {
    const goal = autopilot.goal.trim()
    if (!goal || isAutopilotBusy(autopilot)) return

    dispatchAutopilot({ type: "start-requested" })
    try {
      await window.electronAPI.autopilotStart(goal)
    } catch (error) {
      dispatchAutopilot({ type: "start-failed", error })
    }
  }

  const stopAutopilot = () => {
    void window.electronAPI.autopilotStop().catch(() => {})
    dispatchAutopilot({ type: "reset" })
  }

  const toggleTeaching = () => {
    if (teachingOpen) {
      stopTeaching()
    } else {
      setTeachingOpen(true)
      void refreshPrivacyStatus()
      void refreshAutopilotConsent()
    }
  }

  // Keep the latest-value refs current for the global-hotkey listener.
  useEffect(() => {
    runTeachingOperationRef.current = (op) => void runTeachingOperation(op)
    stopTeachingRef.current = stopTeaching
    teachingPhaseRef.current = teachingSession.phase
    teachingOpenRef.current = teachingOpen
    autopilotRef.current = autopilot
    handleAskAiRef.current = handleAskAi
    handleRecordClickRef.current = () => void handleRecordClick()
    handleNewChatRef.current = handleNewChat
  })

  // Progress for an autopilot run is pushed from main, which owns the loop.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAutopilotUpdate((update) => {
      dispatchAutopilot({ type: "update", update })
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  // Cmd/Ctrl+Enter. Subscribed once, so it reads through a ref — closing over
  // chatInput directly would pin it to its value at mount.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onAskAiHotkey(() => {
      handleAskAiRef.current()
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  // Cmd/Ctrl+N. Same once-subscribed ref indirection — handleNewChat is rebuilt
  // every render and a closure captured here would keep aborting a controller
  // from mount.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onNewChatHotkey(() => {
      handleNewChatRef.current()
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  // Cmd/Ctrl+/. Same ref indirection — the toggle branches on isRecording and
  // mediaRecorder, which a closure captured at mount would freeze at "not
  // recording", so the stop half would never fire.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onRecordHotkey(() => {
      handleRecordClickRef.current()
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  // Global execute/abort hotkeys (Cmd/Ctrl+Shift+Enter / +Backspace). The main
  // process signals here so the panel and overlay update from one round-trip.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onTeachingHotkey((kind) => {
      if (kind === "abort") {
        // Main already aborted an autopilot run before signalling us, and will
        // push a "stopped" update — keep the panel open so the user sees why it
        // ended, rather than having it vanish.
        if (isAutopilotBusy(autopilotRef.current)) return
        if (teachingOpenRef.current) stopTeachingRef.current()
        return
      }
      // Main consumes this itself when autopilot is awaiting confirmation, so
      // reaching here means the manual path owns the keypress.
      if (teachingPhaseRef.current === "step") {
        runTeachingOperationRef.current("execute")
      }
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [])

  // Esc aborts while the teaching panel is focused (the global Backspace combo
  // covers the case where focus has moved to the app being controlled).
  useEffect(() => {
    if (!teachingOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        stopTeaching()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [teachingOpen])

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
          // Read the length now — the next recording resets the counter long
          // before this async chain finishes.
          const clipSeconds = recordingSecondsRef.current
          const history = toHistory(chatMessagesRef.current)
          // Snapshotted at stop, not at record start: a ⌘N pressed mid-clip
          // should still deliver this transcript, just into the empty chat.
          // There is no abort for this path — it is a plain invoke — so the
          // epoch check is the only thing keeping a stale answer out.
          const epoch = chatEpochRef.current
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
                blob.type,
                history
              )
              if (epoch !== chatEpochRef.current) return
              setChatMessages((msgs) => [
                ...msgs,
                createMessage({
                  role: "user",
                  text: result.transcript,
                  source: "voice",
                  durationSec: clipSeconds
                }),
                createMessage({
                  role: "gemini",
                  text: result.text,
                  source: "voice"
                })
              ])
            } catch {
              if (epoch !== chatEpochRef.current) return
              // Still emit the user turn: a header-only "You · voice · 0:12"
              // beats a failure message with nothing explaining what failed.
              setChatMessages((msgs) => [
                ...msgs,
                createMessage({
                  role: "user",
                  text: "",
                  source: "voice",
                  durationSec: clipSeconds
                }),
                createMessage({
                  role: "gemini",
                  text: "Audio analysis failed.",
                  source: "voice"
                })
              ])
            } finally {
              // Only ours to clear: a newer request may already own the spinner.
              if (epoch === chatEpochRef.current) setChatLoading(false)
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

  // Mirrored into a ref because recorder.onstop closes over the value from the
  // moment the recorder was built, which is always 0.
  const recordingSecondsRef = useRef(0)
  recordingSecondsRef.current = recordingSeconds

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

  // Size reporting lives in App.tsx alone. This effect used to run a second
  // ResizeObserver on a descendant of App's container, so every stream chunk
  // produced two setSize calls that fought each other. The tooltip's height now
  // reaches that observer as a real spacer element instead of a number.
  useEffect(() => {
    // Note: onScreenshotTaken is subscribed in its own effect below, which also
    // runs the refetch — registering it here too made every Cmd+H refetch twice.
    const cleanupFunctions = [
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
      cleanupFunctions.forEach((cleanup) => cleanup())
    }
  }, [refetch, setView])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onScreenshotTaken(async (data) => {
      const latest =
        data?.path ||
        (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.path)
      if (!latest) {
        void refetch()
        return
      }

      openPanels()
      setChatLoading(true)
      // Bodyless user turn first, or the analysis reads as an answer to a
      // question nobody asked.
      setChatMessages((msgs) => [
        ...msgs,
        createMessage({ role: "user", text: "", source: "screen" }),
        createMessage({ role: "gemini", text: "", source: "screen" })
      ])
      // Refresh the thumbnail strip alongside the model call rather than in
      // front of it — it fetches multi-megabyte previews over IPC.
      void refetch()
      const epoch = chatEpochRef.current
      const controller = new AbortController()
      chatAbortRef.current = controller
      try {
        await streamChat(
          window.electronAPI,
          "analyze-image-file-stream",
          [latest],
          {
            signal: controller.signal,
            onText: (text) => {
              if (epoch !== chatEpochRef.current) return
              setChatLoading(false)
              replaceLastMessage(text)
            }
          }
        )
      } catch (err) {
        if (epoch !== chatEpochRef.current || isAbortError(err)) return
        replaceLastMessage("Error: " + String(err))
      } finally {
        if (chatAbortRef.current === controller) chatAbortRef.current = null
        if (epoch === chatEpochRef.current) setChatLoading(false)
      }
    })
    return () => {
      unsubscribe && unsubscribe()
    }
  }, [refetch])

  const handleModelChange = (provider: "ollama" | "gemini", model: string) => {
    setCurrentModel({ provider, model })
    // A notice from the app, not an answer — "system" renders it as a centred
    // caption instead of an assistant turn.
    setChatMessages((msgs) => [
      ...msgs,
      createMessage({
        role: "gemini",
        text: `Switched to ${model}.`,
        source: "system"
      })
    ])
  }

  const modelLabel =
    currentModel.provider === "ollama"
      ? currentModel.model
      : "Gemini 3.5 Flash"

  return (
    <div
      ref={contentRef}
      className="select-none relative w-full"
    >
      {/* Bottom padding is load-bearing: the window is sized to this element's
          scrollHeight, and box-shadows don't contribute to layout, so anything
          the surfaces cast beyond this padding is clipped off at the
          transparent window edge. Keep pb >= the largest shadow reach
          (offset + blur/2) in index.css. */}
      <div className="px-3 pt-2 pb-8 space-y-3">
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
            onNewChat={handleNewChat}
            onTeachMe={toggleTeaching}
            onSolve={handleSolve}
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
              onModeChange={(nextMode) => {
                setActiveMode(nextMode)
                showToast(
                  "Mode changed",
                  `Now using ${nextMode.label} mode`,
                  "neutral"
                )
              }}
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
            mode={teachingMode}
            onModeChange={setTeachingMode}
            autopilot={autopilot}
            autopilotConsent={{
              status: autopilotConsent,
              error: autopilotConsentError
            }}
            onAutopilotGoalChange={(goal) =>
              dispatchAutopilot({ type: "set-goal", goal })
            }
            onAutopilotStart={() => void startAutopilot()}
            onAutopilotConfirm={() => {
              void window.electronAPI.autopilotConfirm().catch(() => {})
            }}
            onAutopilotReject={() => {
              void window.electronAPI.autopilotReject().catch(() => {})
            }}
            onAutopilotStop={stopAutopilot}
            onAcceptAutopilotConsent={() => void acceptAutopilotConsent()}
          />
        )}

        {panelsOpen && (
          // Width is per-mode (System Design needs the room), clamped by the
          // display-aware cap main publishes. Deliberately not `100%`: that
          // resolves against the window, which is itself sized from this
          // element, so a narrow window would latch narrow. Inline style
          // because Tailwind can't emit an arbitrary class from a runtime value.
          <div
            className="grid grid-cols-1 gap-3"
            style={{
              width: `min(${mode.panelWidth ?? DEFAULT_PANEL_WIDTH}px, var(--panel-max-w, ${DEFAULT_PANEL_WIDTH}px))`
            }}
          >
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

        {/* The shortcuts tooltip is positioned out of flow, so it contributes
            nothing to scrollHeight and the window would clip it. A spacer puts
            its height back into the layout the size observer measures. */}
        {isTooltipVisible && (
          <div style={{ height: tooltipHeight }} aria-hidden />
        )}
      </div>
    </div>
  )
}

export default Queue
