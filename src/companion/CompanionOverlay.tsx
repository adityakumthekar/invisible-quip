import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, GripVertical, Library, Settings, Sparkles, Square, X } from "lucide-react";
import type { AgentRun, CompanionSnapshot, ContextSettings, Responsibility, StandingAuthority } from "../../electron/companionContract";
import { desktopActions } from "../../electron/companionContract";
import { beginWindowDrag, endWindowDrag } from "../lib/windowDrag";
import SettingsPanel from "../components/shell/SettingsPanel";
import { DynamicSurfaceView } from "./DynamicSurfaceView";
import "./companion.css";

type Run = (work: () => Promise<unknown>) => void;
type AppChoice = { bundleId: string; name: string };
const actionLabels: Record<string, string> = { click: "Click", "double-click": "Double-click", "right-click": "Context menu", type: "Type", key: "Keyboard shortcuts", scroll: "Scroll", drag: "Drag", wait: "Wait" };

function ContextPanel({ state, apps, run }: { state: CompanionSnapshot; apps: AppChoice[]; run: Run }) {
  const [settings, setSettings] = useState<ContextSettings>(state.settings);
  const choices = [...apps, ...settings.apps.filter(id => !apps.some(app => app.bundleId === id)).map(id => ({ bundleId: id, name: id }))];
  return <section className="qc-form" aria-label="Context settings">
    <span className="qc-eyebrow">Your work, in context</span>
    <h2>Let Quip follow along</h2>
    <p>Choose the apps Quip can read. It uses visible text and available window images to understand your work, even when this panel is hidden. Context sent to AI uses your selected provider. Audio stays off until you start a recording.</p>
    <label className="qc-check"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />Follow my work in selected apps</label>
    <fieldset><legend>Apps Quip can read</legend>{choices.map(app => <label className="qc-check" key={app.bundleId}><input type="checkbox" checked={settings.apps.includes(app.bundleId) && !settings.excludedApps.includes(app.bundleId)} onChange={event => setSettings({ ...settings, apps: event.target.checked ? [...new Set([...settings.apps, app.bundleId])] : settings.apps.filter(id => id !== app.bundleId), excludedApps: event.target.checked ? settings.excludedApps.filter(id => id !== app.bundleId) : [...new Set([...settings.excludedApps, app.bundleId])] })} />{app.name}</label>)}{!choices.length && <p>Open the apps you want Quip to follow, then reopen this panel.</p>}</fieldset>
    <label>How should Quip adapt to you?<textarea rows={3} maxLength={6000} placeholder="Your role, preferred language, level of detail, and how you like to work…" value={settings.preferences} onChange={event => setSettings({ ...settings, preferences: event.target.value })} /></label>
    <button className="qc-primary" onClick={() => run(() => window.companion.configure({ ...settings, paused: false }))}>Save context preferences</button>
    <p role="status">{state.contextStatus}</p>
    <details><summary>What Quip remembers</summary><p>Recent summaries stay on this Mac for up to seven days. Raw context images are temporary. Your saved interfaces and notes remain until you remove them.</p><pre>{state.memory.summary || "No observations yet."}</pre><button onClick={() => run(() => window.companion.forget())}>Clear work memory</button></details>
    <details><summary>Overlay visibility</summary><p>Quip requests capture exclusion. Some macOS recording and sharing tools can still include it. Check your sharing preview; the hide shortcut is ⌘B.</p><button onClick={() => run(async () => { const result = await window.electronAPI.privacyRunPreflight(); if (result.status !== "pass") throw new Error("This local capture check did not confirm exclusion. Check your sharing preview."); })}>Check local capture exclusion</button></details>
  </section>;
}

function RunCard({ task, run }: { task: AgentRun; run: Run }) {
  const [reviewed, setReviewed] = useState(false);
  const resumable = ["paused", "blocked", "error"].includes(task.phase);
  return <article className="qc-run"><header><strong>{task.goal}</strong><span className={`qc-phase qc-${task.phase}`}>{task.phase}</span></header><p>{task.outcome}</p><small>{task.steps} / {task.authority.maxSteps} actions</small>{task.checkpoint && <details><summary>Last checkpoint</summary><p>{task.checkpoint}</p></details>}
    {resumable && <>{task.uncertainAction && <label className="qc-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I checked the last action in the target app</label>}<button disabled={task.uncertainAction && !reviewed} onClick={() => run(() => window.companion.resumeRun(task.id, reviewed))}>Reobserve and resume</button></>}
  </article>;
}
function TasksPanel({ state, apps, run }: { state: CompanionSnapshot; apps: AppChoice[]; run: Run }) {
  const [goal, setGoal] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [trigger, setTrigger] = useState<"context" | "schedule">("context");
  const [contains, setContains] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [authority, setAuthority] = useState<StandingAuthority>({ apps: state.context ? [state.context.app.bundleId] : [], targets: state.context?.window.title ? [state.context.window.title] : [], actions: ["click", "type", "key", "scroll", "wait"], maxSteps: 25, maxMinutes: 15 });
  const [targetText, setTargetText] = useState(authority.targets.join("\n"));
  const allowed = apps.filter(app => state.settings.apps.includes(app.bundleId) && !state.settings.excludedApps.includes(app.bundleId));
  const submit = () => run(async () => {
    const scope = { ...authority, targets: targetText.split("\n").map(value => value.trim()).filter(Boolean) };
    if (recurring) {
      const responsibility: Responsibility = { id: editingId ?? crypto.randomUUID(), title: goal.slice(0, 100), goal, enabled: true, authority: scope, trigger: trigger === "context" ? { kind: "context", app: authority.apps[0] || "", contains } : { kind: "schedule", everyMinutes: minutes, nextAt: new Date(Date.now() + minutes * 60000).toISOString() } };
      await window.companion.saveResponsibility(responsibility);
    } else await window.companion.startRun({ goal, authority: scope });
    setGoal(""); setEditingId(null);
  });
  return <section className="qc-form" aria-label="Desktop tasks"><span className="qc-eyebrow">A helping hand while you’re away</span><h2>Give Quip an outcome</h2>
    <label>What should Quip finish?<textarea rows={3} maxLength={6000} placeholder="For example: compare these options and prepare a summary in my open document." value={goal} onChange={event => setGoal(event.target.value)} /></label>
    <fieldset><legend>Apps this task may control</legend>{allowed.map(app => <label className="qc-check" key={app.bundleId}><input type="checkbox" checked={authority.apps.includes(app.bundleId)} onChange={event => setAuthority({ ...authority, apps: event.target.checked ? [...authority.apps, app.bundleId] : authority.apps.filter(id => id !== app.bundleId) })} />{app.name}</label>)}{!allowed.length && <p>Enable apps in Context first.</p>}</fieldset>
    <label>Allowed window titles or document addresses<textarea rows={2} value={targetText} onChange={event => setTargetText(event.target.value)} placeholder="One title or address per line" /><small>Quip can act only when the current window title or document address contains one of these values.</small></label>
    <fieldset className="qc-action-grid"><legend>Actions you authorize in those windows</legend>{desktopActions.map(action => <label className="qc-check" key={action}><input type="checkbox" checked={authority.actions.includes(action)} onChange={event => setAuthority({ ...authority, actions: event.target.checked ? [...authority.actions, action] : authority.actions.filter(value => value !== action) })} />{actionLabels[action]}</label>)}</fieldset>
    <p className="qc-caption">These are standing permissions for this scope. Clicking and typing can submit or change content in the authorized windows. Quip pauses when it needs authority outside this scope.</p>
    <div className="qc-two"><label>Maximum actions<input type="number" min={1} max={100} value={authority.maxSteps} onChange={event => setAuthority({ ...authority, maxSteps: Number(event.target.value) })} /></label><label>Time allowance (minutes)<input type="number" min={1} max={60} value={authority.maxMinutes} onChange={event => setAuthority({ ...authority, maxMinutes: Number(event.target.value) })} /></label></div>
    <label className="qc-check"><input type="checkbox" checked={recurring} onChange={event => setRecurring(event.target.checked)} />Make this a standing responsibility</label>
    {recurring && <><label>Start when<select value={trigger} onChange={event => setTrigger(event.target.value as typeof trigger)}><option value="context">Matching work appears in the first selected app</option><option value="schedule">A scheduled interval arrives</option></select></label>{trigger === "context" ? <label>Text to recognize<input value={contains} onChange={event => setContains(event.target.value)} placeholder="A window title, document, or visible phrase" /></label> : <label>Repeat every (minutes)<input type="number" min={5} max={10080} value={minutes} onChange={event => setMinutes(Number(event.target.value))} /></label>}</>}
    <button className="qc-primary" disabled={!goal.trim() || !authority.apps.length || !targetText.trim() || !state.settings.enabled || state.settings.paused} onClick={submit}>{recurring ? "Save responsibility" : "Start delegated task"}</button>
    <p className="qc-caption">Desktop work needs an awake, unlocked Mac. Use Stop / take over at any time.</p>
    {state.responsibilities.length > 0 && <section><h3>Standing responsibilities</h3>{state.responsibilities.map(item => <article className="qc-run" key={item.id}><strong>{item.title}</strong><p>{item.trigger.kind === "schedule" ? `Every ${item.trigger.everyMinutes} minutes` : `When “${item.trigger.contains}” appears`}</p><div className="qc-actions"><button onClick={() => run(() => window.companion.saveResponsibility({ ...item, enabled: !item.enabled }))}>{item.enabled ? "Pause responsibility" : "Enable responsibility"}</button><button onClick={() => { setEditingId(item.id); setGoal(item.goal); setRecurring(true); setAuthority(item.authority); setTargetText(item.authority.targets.join("\n")); setTrigger(item.trigger.kind); if (item.trigger.kind === "context") setContains(item.trigger.contains); else setMinutes(item.trigger.everyMinutes); }}>Edit</button><button onClick={() => run(() => window.companion.removeResponsibility(item.id))}>Remove</button></div></article>)}</section>}
    <section aria-label="Task history"><h3>Task progress</h3>{!state.runs.length && <p>No delegated tasks yet.</p>}{[...state.runs].reverse().map(task => <RunCard key={task.id} task={task} run={run} />)}</section>
  </section>;
}

export default function CompanionOverlay({ onTools }: { onTools: () => void }) {
  const [state, setState] = useState<CompanionSnapshot | null>(null);
  const [apps, setApps] = useState<AppChoice[]>([]);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("quip-companion-collapsed") === "true");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"work" | "tasks" | "context" | "settings">("work");
  const [prompt, setPrompt] = useState(() => localStorage.getItem("quip-companion-draft") || "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const run: Run = work => { setError(""); void work().catch(error => setError(String(error.message || error).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, ""))); };
  useEffect(() => {
    run(async () => { setState(await window.companion.snapshot()); });
    const unsubscribe = window.companion.onChange(setState);
    const ask = window.electronAPI.onAskAiHotkey(() => { setCollapsed(false); setOpen(true); setTab("work"); requestAnimationFrame(() => promptRef.current?.focus()); });
    return () => { unsubscribe(); ask(); };
  }, []);
  useEffect(() => { localStorage.setItem("quip-companion-collapsed", String(collapsed)); }, [collapsed]);
  useEffect(() => { localStorage.setItem("quip-companion-draft", prompt); }, [prompt]);
  useEffect(() => { if (tab === "context" || tab === "tasks") run(async () => setApps(await window.companion.listApps())); }, [tab, open]);
  const generate = (task: string) => run(async () => {
    setOpen(true); setTab("work");
    const surface = await window.companion.generate(task);
    setSelectedId(surface.id);
    setPrompt(current => current === task ? "" : current);
  });
  const active = state?.runs.find(task => ["thinking", "acting", "queued"].includes(task.phase));
  const selected = state?.surfaces.find(item => item.id === selectedId) ?? state?.surfaces.at(-1);
  const show = () => { setCollapsed(false); setOpen(true); };
  return <div className={`qc-root ${open && !collapsed ? "qc-expanded" : ""}`}>
    <div className="glass-bar qc-bar hit-region">
      <button className="qc-grip" aria-label="Move Quip" onPointerDown={event => { if (event.button === 0) { event.currentTarget.setPointerCapture(event.pointerId); beginWindowDrag(); } }} onPointerUp={endWindowDrag} onLostPointerCapture={endWindowDrag}><GripVertical size={15} /></button>
      <button className="qc-mark" aria-label="Open Quip assistant" onClick={show}>q<span className={active ? "qc-dot qc-working" : state?.cue ? "qc-dot" : ""} /></button>
      {!collapsed && <><button className="qc-ask" onClick={() => { setOpen(!open); setTab("work"); }}>Ask Quip <span>⌘↵</span></button><button title="Saved work and documents" aria-label="Saved work and documents" onClick={() => run(() => window.workspace.openWorkspace())}><Library size={17} /></button><button aria-label="Assistant settings" onClick={() => { setTab("settings"); setOpen(true); }}><Settings size={17} /></button><button aria-label="Collapse Quip" onClick={() => setCollapsed(true)}><ChevronDown size={17} /></button></>}
      {active && <button className="qc-stop" onClick={() => run(() => window.companion.stopRun())}><Square size={12} />Stop / take over</button>}
    </div>
    {!collapsed && !open && state?.cue && <div className="glass-panel-dark qc-cue hit-region"><button onClick={() => generate(state.cue!.task)}><Sparkles size={14} />{state.cue.title}</button><button aria-label="Dismiss suggestion" onClick={() => run(() => window.companion.dismissCue())}><X size={14} /></button></div>}
    {!collapsed && open && <div className="glass-panel-dark qc-panel hit-region">
      <nav aria-label="Assistant panels">{(["work", "tasks", "context", "settings"] as const).map(name => <button aria-pressed={tab === name} key={name} onClick={() => setTab(name)}>{name === "work" ? "Your work" : name[0].toUpperCase() + name.slice(1)}</button>)}<button className="qc-close" aria-label="Close assistant panel" onClick={() => setOpen(false)}><X size={16} /></button></nav>
      {(error || state?.error) && <p className="qc-error" role="alert">{error || state?.error}</p>}
      {!state ? <p role="status">Connecting to your desktop assistant…</p> : <div className="qc-scroll">
        {tab === "work" && <>
          <div className="qc-context-line"><span className={state.settings.enabled && !state.settings.paused ? "qc-live" : ""} />{state.contextStatus}{state.settings.enabled && <button onClick={() => run(() => window.companion.configure({ ...state.settings, paused: !state.settings.paused }))}>{state.settings.paused ? "Resume" : "Pause"}</button>}</div>
          {!state.settings.enabled && <div className="qc-welcome"><span className="qc-eyebrow">Right here, with you</span><h1>A little help.<br />For whatever’s next.</h1><p>Quip follows your work, shapes useful tools around it, and takes on tasks you delegate.</p><button onClick={() => setTab("context")}>Choose apps to follow</button></div>}
          <form className="qc-compose" onSubmit={event => { event.preventDefault(); if (prompt.trim()) generate(prompt); }}><label className="sr-only" htmlFor="quip-task">Ask Quip</label><textarea id="quip-task" ref={promptRef} rows={2} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="What would help with your work?" maxLength={12000} /><button className="qc-primary" type={state.generating ? "button" : "submit"} aria-label={state.generating ? "Stop generating" : "Create task interface"} disabled={!state.generating && !prompt.trim()} onClick={state.generating ? () => run(() => window.companion.cancel()) : undefined}>{state.generating ? <Square size={16} /> : <ArrowUp size={18} />}</button></form>
          {state.generating && <p className="qc-generating" role="status"><Sparkles size={14} />Shaping a tool for this task…</p>}
          {state.surfaces.length > 0 && <label className="qc-surface-picker">Your interfaces<select value={selected?.id || ""} onChange={event => setSelectedId(event.target.value)}>{[...state.surfaces].reverse().map(surface => <option key={surface.id} value={surface.id}>{surface.pinned ? "Pinned · " : surface.saved ? "Saved · " : ""}{surface.title}</option>)}</select></label>}
          {selected && <><DynamicSurfaceView key={selected.id} surface={selected} run={run} /><button className="qc-remove" onClick={() => run(async () => { await window.companion.removeSurface(selected.id); setSelectedId(null); })}>Remove this interface</button></>}
          {!selected && state.settings.enabled && <div className="qc-examples"><p>One companion. A different tool for each task.</p>{["Compare the options I’m researching", "Help me draft a reply from this context", "Turn what I’m learning into a practice checklist"].map(task => <button key={task} onClick={() => generate(task)}>{task}<span>↗</span></button>)}</div>}
        </>}
        {tab === "context" && <ContextPanel state={state} apps={apps} run={run} />}
        {tab === "tasks" && <TasksPanel state={state} apps={apps} run={run} />}
        {tab === "settings" && <><div className="qc-form"><h2>Make Quip yours</h2><p>Provider, appearance, audio and phone controls.</p><div className="qc-actions"><button onClick={onTools}>Open audio and teaching tools</button><button onClick={() => run(() => window.workspace.openWorkspace())}>Documents and account</button></div></div><SettingsPanel /></>}
      </div>}
    </div>}
  </div>;
}
