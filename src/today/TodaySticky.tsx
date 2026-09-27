import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, GripHorizontal, Plus, X } from "lucide-react";
import type { TodaySnapshot } from "../../electron/dailyTaskContract";
import type { TodayStickyAPI } from "../../electron/todayStickyContract";
import "./sticky.css";

declare global {
  interface Window {
    todaySticky: TodayStickyAPI;
  }
}

export default function TodaySticky() {
  const [state, setState] = useState<TodaySnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const [protection, setProtection] = useState<boolean | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const identity = useRef<string | null | undefined>(undefined);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(
        String(error instanceof Error ? error.message : error).replace(
          /^Error invoking remote method '[^']*':\s*(Error:\s*)?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const receive = (snapshot: TodaySnapshot) => {
      if (!active) return;
      if (identity.current !== snapshot.identity) {
        identity.current = snapshot.identity;
        setTitle("");
        setLastCompleted(null);
        setError("");
      }
      setState(snapshot);
    };
    const refresh = () => {
      void window.todaySticky
        .snapshot()
        .then(receive)
        .catch((error) => {
          if (active) setError(error.message);
        });
    };
    const off = window.todaySticky.onChange(receive);
    refresh();
    void window.todaySticky
      .privacy()
      .then((value) => {
        if (active) setProtection(value.captureProtection);
      })
      .catch(() => {});
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void window.todaySticky
          .hide()
          .catch((error) => setError(error.message));
      }
    };
    window.addEventListener("keydown", hideOnEscape);
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      off();
      clearInterval(timer);
      window.removeEventListener("keydown", hideOnEscape);
    };
  }, []);
  const tasks =
    state?.tasks.filter(
      (task) =>
        task.status === "todo" &&
        task.plannedDay !== null &&
        task.plannedDay <= state.day,
    ) ?? [];
  const suggestions =
    state?.tasks.filter((task) => task.status === "suggested").length ?? 0;
  return (
    <main
      className="qs-note glass-panel-dark hit-region"
      aria-label="Today sticky note"
    >
      <header className="qs-drag">
        <span className="qs-wordmark">
          quip <span>· today</span>
        </span>
        <GripHorizontal size={16} aria-hidden="true" />
        <div>
          <button
            aria-label="Open full Today"
            title="Open Today in the protected assistant"
            onClick={() => void run(() => window.todaySticky.openToday())}
          >
            <ArrowUpRight size={16} />
          </button>
          <button
            aria-label="Hide sticky note"
            title="Hide note · Esc"
            onClick={() => void run(() => window.todaySticky.hide())}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="qs-body">
        <div className="qs-heading">
          <h1>A little focus.</h1>
          <span>{tasks.length} to do</span>
        </div>
        <p className="qs-date">
          {state
            ? new Date(`${state.day}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })
            : "Opening your list…"}
        </p>
        {(error || (!state?.ready && state?.error)) && (
          <p className="qs-error" role="alert">
            {error || state?.error}
          </p>
        )}
        {state?.ready && (
          <>
            <div className="qs-tasks" aria-label="Today tasks">
              {tasks.map((task, index) => (
                <article
                  className={index < 3 ? "qs-priority" : ""}
                  key={task.id}
                >
                  <button
                    disabled={busy}
                    className="qs-check"
                    aria-label={`Complete ${task.title}`}
                    onClick={() =>
                      void run(async () => {
                        await window.todaySticky.changeTask({
                          kind: "status",
                          id: task.id,
                          status: "done",
                        });
                        setLastCompleted(task.id);
                      })
                    }
                  >
                    <Check size={12} />
                  </button>
                  <div>
                    <p>{task.title}</p>
                    <small>
                      {index < 3 ? `Priority ${index + 1}` : "Today"}
                      {task.dueAt ? ` · Due ${task.dueAt}` : ""}
                      {task.plannedDay! < state.day ? " · Carried forward" : ""}
                    </small>
                  </div>
                </article>
              ))}
              {!tasks.length && (
                <div className="qs-empty">
                  A clear space for your next step.
                  <br />
                  Add a task to get started.
                </div>
              )}
            </div>
            <form
              className="qs-add"
              onSubmit={(event) => {
                event.preventDefault();
                const text = title.trim();
                if (text)
                  void run(async () => {
                    await window.todaySticky.changeTask({
                      kind: "save",
                      data: {
                        title: text,
                        details: "",
                        plannedDay: state.day,
                        dueAt: null,
                        goalIds: [],
                      },
                    });
                    setTitle("");
                  });
              }}
            >
              <input
                aria-label="New sticky task"
                placeholder="Add a small next step…"
                maxLength={300}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
              <button
                aria-label="Add sticky task"
                disabled={!title.trim() || busy}
              >
                <Plus size={16} />
              </button>
            </form>
            {lastCompleted &&
              state.tasks.some(
                (task) => task.id === lastCompleted && task.status === "done",
              ) && (
                <div className="qs-undo" role="status">
                  Done.{" "}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await window.todaySticky.changeTask({
                          kind: "status",
                          id: lastCompleted,
                          status: "todo",
                        });
                        setLastCompleted(null);
                      })
                    }
                  >
                    Undo
                  </button>
                </div>
              )}
            {suggestions > 0 && (
              <button
                className="qs-suggestions"
                onClick={() => void run(() => window.todaySticky.openToday())}
              >
                {suggestions} suggestion{suggestions === 1 ? "" : "s"} to review{" "}
                <ArrowUpRight size={12} />
              </button>
            )}
          </>
        )}
      </div>
      <footer className="qs-footer">
        <button
          aria-expanded={privacyOpen}
          onClick={() => setPrivacyOpen(!privacyOpen)}
        >
          {protection === false ? "Capture protection off" : "Privacy"}
        </button>
        <span>⌘B hides Quip · Esc hides note</span>
      </footer>
      {privacyOpen && (
        <div className="qs-privacy" role="note">
          {protection === false
            ? "Capture protection is off in this debug build."
            : protection === null
              ? "Capture protection status is unavailable."
              : "This note uses Quip’s capture-exclusion setting."}{" "}
          Some macOS sharing and recording tools can still capture it. Check
          your sharing preview. Your checklist stays saved on this Mac.
        </div>
      )}
    </main>
  );
}
