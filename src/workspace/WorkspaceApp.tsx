import TodayView from "../today/TodayView";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Folder,
  LogOut,
  MessageSquare,
  Monitor,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
  PanelLeftClose,
  Bookmark,
  Cloud,
  WifiOff,
} from "lucide-react";
import type {
  AttachmentPreview,
  Citation,
  Project,
  SavedOutput,
  WorkspaceSnapshot,
} from "../../electron/workspaceContract";
import "./workspace.css";

const api = () => window.workspace;
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const actions = [
  {
    label: "Summarize",
    prompt:
      "Summarize the provided material with the essential facts and decisions.",
  },
  {
    label: "Explain",
    prompt:
      "Explain the provided material in plain language with a useful example.",
  },
  {
    label: "Draft a reply",
    prompt:
      "Draft a reply to the provided message, addressing its questions. Use project context where relevant. Do not invent facts.",
  },
  {
    label: "Rewrite",
    prompt:
      "Improve the clarity and tone of the provided writing while preserving its meaning. Return the revised text.",
  },
  {
    label: "Action items",
    prompt:
      "Extract action items from the provided material. Include owners and deadlines only where stated.",
  },
];
function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children }) => <span className="qw-link">{children}</span>,
        img: ({ alt }) => <span>{alt || "Image"}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
const WorkspaceError = createContext("");
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useContext(WorkspaceError);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="qw-dialog"
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {error && (
        <p className="qw-notice error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
function AttachmentDialog({
  file,
  onClose,
  onChange,
  run,
  onSave,
  readOnly = false,
}: {
  readOnly?: boolean;
  onSave?: () => void;
  file: AttachmentPreview;
  onClose: () => void;
  onChange: (file: AttachmentPreview) => void;
  run: (work: () => Promise<unknown>) => Promise<boolean>;
}) {
  const area = useRef<HTMLDivElement>(null),
    start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const point = (event: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    };
  };
  return (
    <Modal title={file.name} onClose={onClose}>
      <p className="qw-muted">
        {readOnly
          ? "Saved project source."
          : file.kind === "document"
            ? "This document will be saved to the project and indexed when you send it."
            : "This image is temporary. Review it before sending, or drag to select a smaller region."}
      </p>
      {file.kind === "document" ? (
        <pre className="qw-source-text">{file.preview}</pre>
      ) : (
        <div
          ref={area}
          className="qw-crop"
          onPointerDown={(event) => {
            if (readOnly) return;
            start.current = point(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            const p = point(event),
              s = start.current;
            setRect({
              x: Math.min(s.x, p.x),
              y: Math.min(s.y, p.y),
              width: Math.abs(p.x - s.x),
              height: Math.abs(p.y - s.y),
            });
          }}
          onPointerUp={() => {
            start.current = null;
          }}
        >
          <img src={file.preview} alt="Attachment preview" draggable={false} />
          {rect && (
            <div
              className="qw-crop-rect"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
              }}
            />
          )}
        </div>
      )}
      <footer>
        {onSave && <button onClick={onSave}>Save to project</button>}
        {rect && rect.width > 0.01 && rect.height > 0.01 && (
          <button
            onClick={() =>
              void run(async () => {
                onChange(await api().cropAttachment(file.id, rect));
                setRect(null);
              })
            }
          >
            Crop to selection
          </button>
        )}
        <button className="qw-primary" onClick={onClose}>
          {readOnly ? "Close preview" : "Use this context"}
        </button>
      </footer>
    </Modal>
  );
}

export default function WorkspaceApp({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [state, setState] = useState<WorkspaceSnapshot | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState<"projects" | "today">("projects");
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState<"chat" | "sources" | "saved">("chat");
  const [attachments, setAttachments] = useState<AttachmentPreview[]>([]),
    [preview, setPreview] = useState<AttachmentPreview | null>(null),
    [sourceIds, setSourceIds] = useState<string[]>([]);
  const [projectEditor, setProjectEditor] = useState<Project | null>(null),
    [outputEditor, setOutputEditor] = useState<SavedOutput | null>(null),
    [settings, setSettings] = useState(false),
    [citation, setCitation] = useState<Citation | null>(null);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [codeSent, setCodeSent] = useState(false),
    [auth, setAuth] = useState(false),
    [feedback, setFeedback] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [language, setLanguage] = useState("English"),
    [stream, setStream] = useState<{
      conversationId: string;
      text: string;
    } | null>(null);
  const [localWelcome, setLocalWelcome] = useState(
    () => localStorage.getItem("quip.workspace.welcome") !== "done",
  );
  const scroller = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    currentConversation = useRef<string | null>(null);
  const draftValue = useRef(draft),
    pendingDraft = useRef<string | null>(null);
  draftValue.current = draft;
  async function run(work: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      if (currentConversation.current && pendingDraft.current !== null)
        await api().saveDraft(currentConversation.current, draftValue.current);
      await work();
      return true;
    } catch (e) {
      setError(
        (e as Error).message.replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void api()
      .snapshot()
      .then(setState)
      .catch((e) => setError(e.message));
    const off = api().onChange(setState),
      offStream = api().onGeneration((event) => {
        if (event.delta)
          setStream((previous) => ({
            conversationId: event.conversationId,
            text:
              (previous?.conversationId === event.conversationId
                ? previous.text
                : "") + event.delta,
          }));
        if (event.error) setError(event.error);
        if (event.done) setStream(null);
      });
    return () => {
      off();
      offStream();
    };
  }, []);
  useEffect(() => {
    const next = state?.activeConversationId || state?.activeProjectId || null;
    if (next !== currentConversation.current) {
      currentConversation.current = next;
      pendingDraft.current = null;
      setDraft(next ? state?.drafts[next] || "" : "");
      setAttachments([]);
      setSourceIds([]);
      follow.current = true;
    }
  }, [state?.activeConversationId, state?.activeProjectId]);
  useEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [stream, state?.messages.length]);
  useEffect(() => {
    const active = state?.activeConversationId || state?.activeProjectId;
    if (!active || active !== currentConversation.current) return;
    const incoming = state?.drafts[active] || "";
    if (pendingDraft.current === incoming) pendingDraft.current = null;
    if (pendingDraft.current === null) setDraft(incoming);
  }, [state?.drafts, state?.activeConversationId, state?.activeProjectId]);
  function updateDraft(text: string) {
    pendingDraft.current = text;
    draftValue.current = text;
    setDraft(text);
    const conversation = currentConversation.current;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (conversation)
      draftTimer.current = setTimeout(() => {
        void api()
          .saveDraft(conversation, text)
          .catch((e) => setError(e.message));
      }, 200);
  }
  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );
  if (!state)
    return (
      <div className="qw-loading">
        <Sparkles />
        <span>Opening your workspace…</span>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  const project = state.projects.find((p) => p.id === state.activeProjectId),
    conversation = state.conversations.find(
      (c) => c.id === state.activeConversationId,
    );
  const messages = state.messages.filter(
      (m) => m.conversationId === conversation?.id,
    ),
    sources = state.sources.filter((s) => s.projectId === project?.id),
    outputs = state.outputs.filter((o) => o.projectId === project?.id);
  const conversations = state.conversations
    .filter((c) => c.projectId === project?.id)
    .filter(
      (c) =>
        !search ||
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        state.messages.some(
          (m) =>
            m.conversationId === c.id &&
            m.text.toLowerCase().includes(search.toLowerCase()),
        ),
    );
  const welcome = localWelcome && !state.account && !state.projects.length;
  const openNewProject = () =>
    setProjectEditor({
      id: id(),
      name: "",
      instructions: "",
      updatedAt: now(),
    });
  async function newChat() {
    if (!project) return;
    await run(async () => {
      const c = {
        id: id(),
        projectId: project.id,
        title: "New conversation",
        updatedAt: now(),
      };
      await api().saveConversation(c);
      setTab("chat");
    });
  }
  async function attach(capture = false) {
    await run(async () => {
      if (attachments.length >= 4)
        throw new Error("You can attach up to four items per question.");
      const file = capture
        ? await api().captureScreen()
        : await api().pickFile();
      if (file) {
        setAttachments((previous) => [...previous, file]);
        setPreview(file);
      }
    });
  }
  async function send() {
    if (!draft.trim() || state?.generating || !project) return;
    if (!state?.account && !window.companion) { setAuth(true); return; }
    const text = draft;
    const ok = await run(async () => {
      let target = conversation;
      if (!target) {
        target = {
          id: id(),
          projectId: project.id,
          title: text.slice(0, 65),
          updatedAt: now(),
        };
        await api().saveConversation(target);
      } else if (target.title === "New conversation")
        await api().saveConversation({ ...target, title: text.slice(0, 65) });
      await api().saveDraft(target.id, text);
      follow.current = true;
      setTab("chat");
      setStream({ conversationId: target.id, text: "" });
      await api().generate({
        requestId: id(),
        conversationId: target.id,
        text,
        attachmentIds: attachments.map((file) => file.id),
        sourceIds,
      });
    });
    if (ok) {
      setDraft((current) => (current === text ? "" : current));
      setAttachments([]);
    }
    setStream(null);
  }
  function saveMessage(text: string) {
    if (project)
      setOutputEditor({
        id: id(),
        projectId: project.id,
        title: conversation?.title || "Saved note",
        text,
        updatedAt: now(),
      });
  }
  const accountModal = auth || welcome;
  return (
    <WorkspaceError.Provider value={error}>
      <div className={`qw-app ${compact ? "qw-compact" : ""}`}>
        {!compact && (
          <aside className="qw-sidebar">
            <div className="qw-brand">
              <span className="qw-brand-mark">
                <Sparkles size={20} />
              </span>
              quip<span className="qw-beta">BETA</span>
            </div>
            <button className={`qw-project-link ${destination === "today" ? "active" : ""}`} aria-pressed={destination === "today"} onClick={() => setDestination("today")}>Today</button>
            <button className="qw-new-project" onClick={openNewProject}>
              <Plus size={17} /> New project
            </button>
            <label className="qw-search">
              <Search size={16} />
              <input
                aria-label="Search projects and conversations"
                placeholder="Search your work"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="qw-section-label">PROJECTS</div>
            <nav aria-label="Projects">
              {state.projects
                .filter(
                  (p) =>
                    !search ||
                    p.name.toLowerCase().includes(search.toLowerCase()) ||
                    p.id === project?.id,
                )
                .map((p) => (
                  <button
                    key={p.id}
                    className={`qw-project-link ${destination === "projects" && p.id === project?.id ? "active" : ""}`}
                    onClick={() =>
                      void run(async () => {
                        await api().select(p.id, null);
                        setDestination("projects");
                        setTab("chat");
                      })
                    }
                  >
                    <Folder size={17} />
                    <span>{p.name}</span>
                    {p.id === project?.id && <ChevronRight size={14} />}
                  </button>
                ))}
            </nav>
            {project && (
              <>
                <div className="qw-section-label qw-conversations-label">
                  CONVERSATIONS
                  <button
                    aria-label="New conversation"
                    onClick={() => void newChat()}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <nav aria-label="Conversations">
                  {conversations.map((c) => (
                    <button
                      className={`qw-conversation-link ${c.id === conversation?.id ? "active" : ""}`}
                      key={c.id}
                      onClick={() =>
                        void run(async () => {
                          await api().select(c.projectId, c.id);
                          setDestination("projects");
                        setTab("chat");
                        })
                      }
                    >
                      <MessageSquare size={15} />
                      <span>{c.title}</span>
                    </button>
                  ))}
                </nav>
              </>
            )}
            <div className="qw-sidebar-bottom">
              <div className="qw-storage">
                <span>
                  {state.account ? <Cloud size={15} /> : <Folder size={15} />}{" "}
                  {state.account ? "Synced workspace" : "Local workspace"}
                </span>
                <small>
                  {state.account
                    ? `${state.usage?.used || 0} / ${state.usage?.limit || 30} AI requests used`
                    : "Sign in for managed AI and cloud sync"}
                </small>
              </div>
              <button className="qw-account" onClick={() => setSettings(true)}>
                <span className="qw-avatar">
                  {state.account?.email[0]?.toUpperCase() || "Q"}
                </span>
                <span>
                  {state.account?.email || "Your account"}
                  <small>
                    {state.usage?.plan === "pro"
                      ? "Quip Pro"
                      : "Personal workspace"}
                  </small>
                </span>
                <Settings size={16} />
              </button>
            </div>
          </aside>
        )}
        <main className="qw-main">
          <header className="qw-topbar">
            {compact ? (
              <>
                <span className="qw-brand-mark">
                  <Sparkles size={16} />
                </span>
                <select
                  aria-label="Project"
                  value={project?.id || ""}
                  onChange={(e) =>
                    void run(() => api().select(e.target.value, null))
                  }
                >
                  <option value="" disabled>
                    Select a project
                  </option>
                  {state.projects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  title="Open workspace"
                  aria-label="Open workspace"
                  onClick={() => void api().openWorkspace()}
                >
                  <PanelLeftClose size={17} />
                </button>
                <button
                  aria-label="Hide assistant"
                  onClick={() => void api().toggleOverlay()}
                >
                  <X size={17} />
                </button>
              </>
            ) : (
              <>
                <span className="qw-breadcrumb">
                  Workspace <ChevronRight size={13} />{" "}
                  <strong>{destination === "today" ? "Today" : project?.name || "Welcome"}</strong>
                </span>
                <div className="qw-top-actions">
                  {!state.online ? (
                    <span className="qw-status offline">
                      <WifiOff size={13} />
                      Offline
                    </span>
                  ) : (
                    <span className="qw-status">
                      <span />
                      {state.account ? "Cloud connected" : "Saved on this Mac"}
                    </span>
                  )}
                  <button
                    aria-label="Refresh and resume indexing"
                    disabled={busy}
                    onClick={() => void run(() => api().refresh())}
                  >
                    <RefreshCw size={16} />
                  </button>
                  <button onClick={() => void api().toggleOverlay()}>
                    <Monitor size={15} />
                    Open assistant
                  </button>
                </div>
              </>
            )}
          </header>
          {(error || notice) && (
            <div
              className={`qw-notice ${error ? "error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <span>{error || notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {state.update && (
            <div className="qw-notice">
              <span>{state.update}</span>
              {state.update.includes("ready") && (
                <button onClick={() => void api().installUpdate()}>
                  Restart
                </button>
              )}
            </div>
          )}
          {destination === "today" ? <div className="qw-today"><TodayView /></div> : !project ? (
            <section className="qw-empty-workspace">
              <span className="qw-hero-icon">
                <Sparkles size={30} />
              </span>
              <div className="qw-eyebrow">
                A LITTLE CONTEXT. A LOT OF POSSIBILITY.
              </div>
              <h1>
                Make room for
                <br />
                your best work.
              </h1>
              <p>
                Bring in a brief, a screen, or a question.
                <br />
                Turn it into something worth keeping.
              </p>
              <button className="qw-primary" onClick={openNewProject}>
                <Plus size={17} />
                Create your first project
              </button>
              <div className="qw-use-cases">
                <div>
                  <Monitor />
                  <strong>Understand what’s in front of you</strong>
                  <span>Ask about a screen or document.</span>
                </div>
                <div>
                  <FileText />
                  <strong>Find the words that work</strong>
                  <span>Draft, rewrite, and make things clear.</span>
                </div>
                <div>
                  <Bookmark />
                  <strong>Keep the useful parts</strong>
                  <span>Build on your work, one project at a time.</span>
                </div>
              </div>
            </section>
          ) : (
            <>
              {!compact && (
                <div className="qw-project-header">
                  <div>
                    <div className="qw-eyebrow">YOUR PROJECT</div>
                    <h1>{project.name}</h1>
                    <p>
                      {project.instructions
                        ? "Using your project instructions to keep answers relevant."
                        : "A home for your questions, sources, and useful ideas."}
                    </p>
                  </div>
                  <button onClick={() => setProjectEditor({ ...project })}>
                    <Settings size={15} />
                    Project settings
                  </button>
                </div>
              )}
              {!compact && (
                <div
                  className="qw-tabs"
                  role="tablist"
                  aria-label="Project content"
                >
                  {(
                    [
                      ["chat", "Conversations", MessageSquare],
                      ["sources", "Sources", FileText],
                      ["saved", "Saved work", Bookmark],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      role="tab"
                      aria-selected={tab === key}
                      aria-controls={`qw-${key}`}
                      onClick={() => setTab(key)}
                    >
                      <Icon size={16} />
                      {label}
                      {key === "sources" && <span>{sources.length}</span>}
                      {key === "saved" && <span>{outputs.length}</span>}
                    </button>
                  ))}
                </div>
              )}
              {(compact || tab === "chat") && (
                <section className="qw-chat" id="qw-chat" role="tabpanel">
                  {conversation && !compact && (
                    <div className="qw-chat-title">
                      <span>{conversation.title}</span>
                      <button
                        aria-label="Export conversation"
                        onClick={() =>
                          void run(() =>
                            api().exportText(
                              conversation.title,
                              messages
                                .map(
                                  (m) =>
                                    `## ${m.role === "user" ? "You" : "Quip"}\n\n${m.text}`,
                                )
                                .join("\n\n"),
                            ),
                          )
                        }
                      >
                        <Download size={15} />
                      </button>
                      <button
                        aria-label="Delete conversation"
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this conversation? This cannot be undone.",
                            )
                          )
                            void run(() =>
                              api().deleteConversation(conversation.id),
                            );
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                  <div
                    className="qw-messages"
                    ref={scroller}
                    onScroll={() => {
                      const el = scroller.current!;
                      follow.current =
                        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                    }}
                    aria-live="polite"
                  >
                    {!messages.length && !stream && (
                      <div className="qw-chat-welcome">
                        <span className="qw-hero-icon small">
                          <Sparkles size={23} />
                        </span>
                        <h2>What are we working on?</h2>
                        <p>
                          Ask a question, attach some context, or start with a
                          quick action.
                        </p>
                        <div className="qw-action-grid">
                          {actions.slice(0, 4).map((action) => (
                            <button
                              key={action.label}
                              onClick={() => updateDraft(action.prompt)}
                            >
                              {action.label}
                              <ChevronRight size={14} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {messages.map((message) => (
                      <article
                        key={message.id}
                        className={`qw-message ${message.role}`}
                      >
                        <div className="qw-message-author">
                          {message.role === "assistant" ? (
                            <>
                              <Sparkles size={15} />
                              Quip
                            </>
                          ) : (
                            "You"
                          )}
                          {message.status !== "complete" && (
                            <span>Interrupted</span>
                          )}
                        </div>
                        <div className="qw-markdown">
                          <Markdown text={message.text} />
                        </div>
                        {message.citations.length > 0 && (
                          <div className="qw-citations">
                            {message.citations.map((ref, index) => (
                              <button
                                key={index}
                                onClick={() => setCitation(ref)}
                              >
                                <FileText size={12} />
                                {ref.label}
                                {ref.page ? ` · p. ${ref.page}` : ""}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="qw-message-actions">
                          <button
                            aria-label="Copy message"
                            onClick={() =>
                              void run(async () => {
                                await api().copyText(message.text);
                                setNotice("Copied to clipboard.");
                              })
                            }
                          >
                            <Copy size={14} />
                          </button>
                          {message.role === "assistant" && (
                            <button onClick={() => saveMessage(message.text)}>
                              <Bookmark size={14} />
                              Save
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                    {stream?.conversationId === conversation?.id && (
                      <article className="qw-message assistant">
                        <div className="qw-message-author">
                          <Sparkles size={15} />
                          Quip<span className="qw-thinking">Working…</span>
                        </div>
                        <div className="qw-markdown">
                          <Markdown
                            text={stream?.text || "Reading your context…"}
                          />
                        </div>
                      </article>
                    )}
                  </div>
                  <div className="qw-composer-area">
                    <div className="qw-quick-actions">
                      {actions.map((action) => (
                        <button
                          key={action.label}
                          onClick={() => updateDraft(action.prompt)}
                        >
                          {action.label}
                        </button>
                      ))}
                      <button
                        onClick={() =>
                          updateDraft(
                            `Translate the provided material into ${language}, preserving meaning and formatting.`,
                          )
                        }
                      >
                        Translate
                      </button>
                      <input
                        aria-label="Translation language"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        placeholder="Language"
                      />
                    </div>
                    <div className="qw-composer">
                      {attachments.length > 0 && (
                        <div className="qw-attachments">
                          {attachments.map((file) => (
                            <span key={file.id}>
                              <button onClick={() => setPreview(file)}>
                                <Paperclip size={13} />
                                {file.name}
                              </button>
                              <button
                                aria-label={`Remove ${file.name}`}
                                onClick={() => {
                                  void api().discardAttachment(file.id);
                                  setAttachments((current) =>
                                    current.filter((f) => f.id !== file.id),
                                  );
                                }}
                              >
                                <X size={13} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <textarea
                        aria-label="Message Quip"
                        disabled={busy && !state.generating}
                        placeholder={
                          state.account
                            ? "Ask anything about your work…"
                            : "Ask Quip using your configured desktop provider…"
                        }
                        value={draft}
                        maxLength={24000}
                        onChange={(e) => updateDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void send();
                          }
                        }}
                      />
                      <div className="qw-composer-toolbar">
                        <button
                          aria-label="Attach a file"
                          title="Attach a file"
                          disabled={busy}
                          onClick={() => void attach()}
                        >
                          <Paperclip size={18} />
                        </button>
                        <button
                          title="Capture screen and preview"
                          disabled={busy}
                          onClick={() => void attach(true)}
                        >
                          <Monitor size={17} />
                          <span>Screen</span>
                        </button>
                        <span className="qw-context-label">
                          {sourceIds.length
                            ? `${sourceIds.length} selected sources`
                            : sources.some(
                                  (s) =>
                                    s.kind === "document" &&
                                    s.status === "ready",
                                )
                              ? "Project documents included"
                              : "Selected sources and enabled desktop context"}
                        </span>
                        {state.generating ? (
                          <button
                            className="qw-send stop"
                            aria-label="Stop generating"
                            onClick={() =>
                              void run(() => api().cancelGeneration())
                            }
                          >
                            <Square size={15} />
                          </button>
                        ) : (
                          <button
                            className="qw-send"
                            aria-label="Send message"
                            disabled={!draft.trim() || busy}
                            onClick={() => void send()}
                          >
                            <ArrowUp size={20} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="qw-composer-note">
                      {state.account
                        ? "Chosen context is processed in the cloud. Review important details."
                        : "Local drafts stay on this Mac. Cloud AI requires sign-in."}
                      <span>⌘ ↵ to send</span>
                    </p>
                  </div>
                </section>
              )}
              {!compact && tab === "sources" && (
                <section id="qw-sources" className="qw-library" role="tabpanel">
                  <div className="qw-library-heading">
                    <div>
                      <h2>Context you can come back to</h2>
                      <p>
                        Project documents ground your answers. Select specific
                        sources to narrow your next question.
                      </p>
                    </div>
                    <button
                      className="qw-primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const file = await api().pickFile();
                          if (file) {
                            setAttachments((current) => [...current, file]);
                            setPreview(file);
                          }
                        })
                      }
                    >
                      <Plus size={16} />
                      Add source
                    </button>
                  </div>
                  {!sources.length && (
                    <div className="qw-library-empty">
                      <FileText size={30} />
                      <h3>Your project starts with good context.</h3>
                      <p>Add a brief, reference document, or image.</p>
                    </div>
                  )}
                  {sources.map((source) => (
                    <div className="qw-source-row" key={source.id}>
                      <input
                        type="checkbox"
                        aria-label={`Use ${source.name}`}
                        checked={sourceIds.includes(source.id)}
                        disabled={source.status !== "ready"}
                        onChange={(e) =>
                          setSourceIds((current) =>
                            e.target.checked
                              ? [...current, source.id]
                              : current.filter((id) => id !== source.id),
                          )
                        }
                      />
                      <FileText size={22} />
                      <button
                        onClick={() =>
                          void run(async () => {
                            const detail = await api().readSource(source.id);
                            if (detail.preview)
                              setPreview({
                                id: source.id,
                                name: source.name,
                                mimeType: source.mimeType,
                                size: source.size,
                                kind: "image",
                                sections: [],
                                preview: detail.preview,
                              });
                            else
                              setCitation({
                                sourceId: source.id,
                                label: source.name,
                                excerpt: detail.sections
                                  .map(
                                    (section) =>
                                      `${section.page ? `Page ${section.page}\n` : ""}${section.text}`,
                                  )
                                  .join("\n\n"),
                              });
                          })
                        }
                      >
                        <strong>{source.name}</strong>
                        <small>
                          {Math.round(source.size / 1024)} KB · {source.status}
                        </small>
                      </button>
                      <button
                        aria-label={`Delete ${source.name}`}
                        onClick={() => {
                          if (
                            confirm(`Delete ${source.name} from this project?`)
                          )
                            void run(() => api().deleteSource(source.id));
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {!compact && tab === "saved" && (
                <section id="qw-saved" className="qw-library" role="tabpanel">
                  <div className="qw-library-heading">
                    <div>
                      <h2>The parts worth keeping</h2>
                      <p>Your notes and drafts, ready for the next step.</p>
                    </div>
                    <button
                      className="qw-primary"
                      onClick={() =>
                        setOutputEditor({
                          id: id(),
                          projectId: project.id,
                          title: "Untitled note",
                          text: "",
                          updatedAt: now(),
                        })
                      }
                    >
                      <Plus size={16} />
                      New note
                    </button>
                  </div>
                  <div className="qw-output-grid">
                    {outputs
                      .filter(
                        (output) =>
                          !search ||
                          `${output.title} ${output.text}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((output) => (
                        <button
                          className="qw-output-card"
                          key={output.id}
                          onClick={() => setOutputEditor({ ...output })}
                        >
                          <Bookmark size={18} />
                          <h3>{output.title}</h3>
                          <p>
                            {output.text.slice(0, 180) ||
                              "An empty page, ready for an idea."}
                          </p>
                          <small>
                            {new Date(output.updatedAt).toLocaleDateString()}
                          </small>
                        </button>
                      ))}
                  </div>
                  {!outputs.length && (
                    <div className="qw-library-empty">
                      <Bookmark size={30} />
                      <h3>Useful work deserves a home.</h3>
                      <p>Save a Quip response or write a note of your own.</p>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </main>
        {projectEditor && (
          <Modal
            title={
              state.projects.some((p) => p.id === projectEditor.id)
                ? "Project settings"
                : "Create a project"
            }
            onClose={() => setProjectEditor(null)}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api().saveProject(projectEditor);
                  setDestination("projects");
                  setProjectEditor(null);
                  setTab("chat");
                });
              }}
            >
              <label>
                Project name
                <input
                  autoFocus
                  required
                  maxLength={160}
                  value={projectEditor.name}
                  placeholder="Client work, research, a new idea…"
                  onChange={(e) =>
                    setProjectEditor({ ...projectEditor, name: e.target.value })
                  }
                />
              </label>
              <label>
                Project instructions
                <textarea
                  maxLength={8000}
                  value={projectEditor.instructions}
                  placeholder="What should Quip know? Your audience, preferred tone, goals, or important constraints."
                  onChange={(e) =>
                    setProjectEditor({
                      ...projectEditor,
                      instructions: e.target.value,
                    })
                  }
                />
              </label>
              <p className="qw-muted">
                {state.account
                  ? "Saved to your private cloud workspace."
                  : "Saved on this Mac. Local projects stay separate from your cloud account."}
              </p>
              <footer>
                {state.projects.some((p) => p.id === projectEditor.id) && (
                  <button
                    type="button"
                    className="qw-danger"
                    onClick={() => {
                      if (
                        confirm(
                          "Delete this project and all its conversations, sources, and saved work?",
                        )
                      )
                        void run(async () => {
                          await api().deleteProject(projectEditor.id);
                          setProjectEditor(null);
                        });
                    }}
                  >
                    Delete project
                  </button>
                )}
                <button className="qw-primary" disabled={busy} type="submit">
                  Save project
                </button>
              </footer>
            </form>
          </Modal>
        )}
        {outputEditor && (
          <Modal title="Saved work" onClose={() => setOutputEditor(null)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api().saveOutput(outputEditor);
                  setOutputEditor(null);
                  setNotice("Saved to your project.");
                });
              }}
            >
              <label>
                Title
                <input
                  required
                  maxLength={160}
                  value={outputEditor.title}
                  onChange={(e) =>
                    setOutputEditor({ ...outputEditor, title: e.target.value })
                  }
                />
              </label>
              <label>
                Note or draft
                <textarea
                  className="qw-note-editor"
                  value={outputEditor.text}
                  maxLength={100000}
                  onChange={(e) =>
                    setOutputEditor({ ...outputEditor, text: e.target.value })
                  }
                />
              </label>
              <footer>
                <button
                  type="button"
                  onClick={() =>
                    void run(() =>
                      api().exportText(outputEditor.title, outputEditor.text),
                    )
                  }
                >
                  <Download size={15} />
                  Export
                </button>
                {outputs.some((o) => o.id === outputEditor.id) && (
                  <button
                    type="button"
                    className="qw-danger"
                    onClick={() => {
                      if (confirm("Delete this saved note?"))
                        void run(async () => {
                          await api().deleteOutput(outputEditor.id);
                          setOutputEditor(null);
                        });
                    }}
                  >
                    Delete
                  </button>
                )}
                <button className="qw-primary" type="submit" disabled={busy}>
                  Save
                </button>
              </footer>
            </form>
          </Modal>
        )}
        {preview && (
          <>
            <AttachmentDialog
              file={preview}
              readOnly={!attachments.some((file) => file.id === preview.id)}
              onSave={
                project &&
                state.account &&
                attachments.some((f) => f.id === preview.id)
                  ? () =>
                      void run(async () => {
                        await api().saveAttachment(preview.id, project.id);
                        setPreview(null);
                        setAttachments((current) =>
                          current.filter((f) => f.id !== preview.id),
                        );
                        setNotice("Source saved to the project.");
                      })
                  : undefined
              }
              onClose={() => setPreview(null)}
              onChange={(file) => {
                setPreview(file);
                setAttachments((current) =>
                  current.map((f) => (f.id === file.id ? file : f)),
                );
              }}
              run={run}
            />
            {/* Save is an explicit action in the preview footer below. */}
          </>
        )}

        {citation && (
          <Modal title={citation.label} onClose={() => setCitation(null)}>
            <p className="qw-muted">
              {citation.page ? `Page ${citation.page}` : "Source excerpt"}
            </p>
            <pre className="qw-source-text">{citation.excerpt}</pre>
          </Modal>
        )}
        {accountModal && (
          <Modal
            title={
              welcome ? "Your work, with a little help." : "Sign in to Quip"
            }
            onClose={() => {
              setAuth(false);
              setLocalWelcome(false);
              localStorage.setItem("quip.workspace.welcome", "done");
            }}
          >
            <p className="qw-muted">
              Use managed AI and keep your projects in sync across your Macs.
              Screen captures are only sent when you choose.
            </p>
            {!state.configured && (
              <div className="qw-notice">
                Cloud access is not available in this build yet. You can create
                local projects and drafts.
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (codeSent) {
                    await api().verifyCode(email, code);
                    setAuth(false);
                    setLocalWelcome(false);
                    localStorage.setItem("quip.workspace.welcome", "done");
                  } else {
                    await api().signIn(email);
                    setCodeSent(true);
                  }
                });
              }}
            >
              <label>
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setCodeSent(false);
                  }}
                  placeholder="you@example.com"
                />
              </label>
              {codeSent && (
                <label>
                  Code from your email
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Enter your sign-in code"
                  />
                </label>
              )}
              <button
                className="qw-primary qw-full"
                disabled={busy || !state.configured}
              >
                {busy
                  ? "Please wait…"
                  : codeSent
                    ? "Verify and continue"
                    : "Email me a sign-in code"}
              </button>
            </form>
            <button
              className="qw-text-button"
              onClick={() => {
                setAuth(false);
                setLocalWelcome(false);
                localStorage.setItem("quip.workspace.welcome", "done");
              }}
            >
              Start with local drafts
            </button>
          </Modal>
        )}
        {settings && (
          <Modal title="Your workspace" onClose={() => setSettings(false)}>
            <div className="qw-settings-account">
              <span className="qw-avatar">
                {state.account?.email[0]?.toUpperCase() || "Q"}
              </span>
              <div>
                <strong>{state.account?.email || "Local workspace"}</strong>
                <p>
                  {state.account
                    ? "Your projects are private to your account."
                    : "Local drafts stay separate from cloud projects."}
                </p>
              </div>
            </div>
            {!state.account ? (
              <button
                className="qw-primary"
                onClick={() => {
                  setSettings(false);
                  setAuth(true);
                }}
              >
                Sign in for AI and sync
              </button>
            ) : (
              <>
                <div className="qw-plan">
                  <div>
                    <strong>
                      {state.usage?.plan === "pro" ? "Quip Pro" : "Quip trial"}
                    </strong>
                    <span>
                      {state.usage?.used || 0} of {state.usage?.limit || 30}{" "}
                      requests used
                    </span>
                    <span>
                      {((state.usage?.storageUsed || 0) / 1048576).toFixed(1)}{" "}
                      MB of 1 GB storage
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      void run(() =>
                        api().openBilling(
                          state.usage?.plan === "pro" ? "portal" : "checkout",
                        ),
                      )
                    }
                  >
                    {state.usage?.plan === "pro"
                      ? "Manage billing"
                      : "Get Pro · $19/month"}
                  </button>
                </div>
                <p className="qw-muted">
                  {state.usage?.resetsAt
                    ? `Allowance period ends ${new Date(state.usage.resetsAt).toLocaleDateString()}. `
                    : ""}
                  Saved work stays available when your AI allowance ends.
                </p>
                <label>
                  Send feedback
                  <textarea
                    value={feedback}
                    maxLength={4000}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="What worked? What got in your way? Do not include sensitive content."
                  />
                </label>
                <button
                  disabled={!feedback.trim() || busy}
                  onClick={() =>
                    void run(async () => {
                      await api().feedback(feedback);
                      setFeedback("");
                      setNotice("Feedback sent. Thank you.");
                    })
                  }
                >
                  Send feedback
                </button>
              </>
            )}
            <div className="qw-settings-actions">
              <button onClick={() => void run(() => api().exportAccount())}>
                <Download size={16} />
                Export all work
              </button>
              {state.account && (
                <button
                  onClick={() =>
                    void run(async () => {
                      await api().signOut();
                      setSettings(false);
                    })
                  }
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              )}
            </div>
            {state.account && (
              <details className="qw-delete-account">
                <summary>Delete account and cloud data</summary>
                <p>
                  This deletes your projects and files and cancels your
                  subscription. Export your work first if you want to keep it.
                </p>
                <input
                  aria-label="Type DELETE to confirm account deletion"
                  placeholder="Type DELETE"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
                <button
                  className="qw-danger"
                  disabled={confirmation !== "DELETE" || busy}
                  onClick={() =>
                    void run(async () => {
                      await api().deleteAccount(confirmation);
                      setSettings(false);
                      setConfirmation("");
                    })
                  }
                >
                  Delete my account
                </button>
              </details>
            )}
          </Modal>
        )}
      </div>
    </WorkspaceError.Provider>
  );
}
