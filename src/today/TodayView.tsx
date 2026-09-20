import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  localDay,
  type DailyGoal,
  type DailyTask,
  type TaskChange,
  type TodaySnapshot,
} from "../../electron/dailyTaskContract";
import "./today.css";

type Run = (work: () => Promise<unknown>, lock?: boolean) => Promise<boolean>;
function TaskEditor({
  task,
  day,
  goals,
  run,
  close,
}: {
  task: DailyTask | null;
  day: string;
  goals: DailyGoal[];
  run: Run;
  close: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [details, setDetails] = useState(task?.details ?? "");
  const [dueAt, setDueAt] = useState(task?.dueAt ?? "");
  const [plannedDay, setPlannedDay] = useState(
    task ? (task.plannedDay ?? "") : day,
  );
  const [goalIds, setGoalIds] = useState(task?.goalIds ?? []);
  return (
    <form
      className="qt-editor"
      aria-label={task ? "Edit task" : "New task"}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await window.companion.changeTask({
            kind: "save",
            id: task?.id,
            data: {
              title,
              details,
              dueAt: dueAt || null,
              plannedDay: plannedDay || null,
              goalIds,
            },
          });
          close();
        });
      }}
    >
      <label>
        Task title
        <input
          autoFocus
          required
          maxLength={300}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Details
        <textarea
          rows={3}
          maxLength={6000}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
      </label>
      <div className="qt-dates">
        <label>
          Planned day
          <input
            type="date"
            value={plannedDay}
            onChange={(event) => setPlannedDay(event.target.value)}
          />
          <small>Leave blank to save for later.</small>
        </label>
        <label>
          Deadline
          <input
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
          <small>Only if there is a real deadline.</small>
        </label>
      </div>
      {!!goals.length && (
        <fieldset>
          <legend>Supports these goals</legend>
          {goals.map((goal) => (
            <label className="qt-check" key={goal.id}>
              <input
                type="checkbox"
                checked={goalIds.includes(goal.id)}
                onChange={(event) =>
                  setGoalIds(
                    event.target.checked
                      ? [...goalIds, goal.id]
                      : goalIds.filter((id) => id !== goal.id),
                  )
                }
              />
              {goal.text}
            </label>
          ))}
        </fieldset>
      )}
      <div className="qt-actions">
        <button className="qt-primary" type="submit" disabled={!title.trim()}>
          Save task
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function GoalEditor({
  goals,
  save,
  close,
}: {
  goals: DailyGoal[];
  save: (goals: DailyGoal[]) => void;
  close: () => void;
}) {
  const [values, setValues] = useState(
    Array.from({ length: 3 }, (_, index) => ({
      id: goals[index]?.id ?? crypto.randomUUID(),
      text: goals[index]?.text ?? "",
    })),
  );
  return (
    <form
      className="qt-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save(
          values
            .map((goal) => ({ ...goal, text: goal.text.trim() }))
            .filter((goal) => goal.text),
        );
      }}
    >
      <p>
        What would make these days well spent? Choose up to three priorities.
      </p>
      {values.map((goal, index) => (
        <label key={goal.id}>
          Goal {index + 1}
          <input
            maxLength={300}
            value={goal.text}
            onChange={(event) =>
              setValues(
                values.map((value, i) =>
                  i === index ? { ...value, text: event.target.value } : value,
                ),
              )
            }
          />
        </label>
      ))}
      <div className="qt-actions">
        <button className="qt-primary" type="submit">
          Save goals
        </button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function TaskCard({
  task,
  snapshot,
  index,
  total,
  today,
  run,
  edit,
}: {
  task: DailyTask;
  snapshot: TodaySnapshot;
  index: number;
  total: number;
  today: boolean;
  run: Run;
  edit: () => void;
}) {
  const change = (value: TaskChange) => {
    void run(() => window.companion.changeTask(value));
  };
  const date = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return (
    <article
      className={`qt-task ${task.status === "done" ? "qt-done" : ""} ${today && index < 3 ? "qt-focus" : ""}`}
      aria-label={task.title}
    >
      <div className="qt-task-heading">
        {task.status === "todo" && (
          <button
            className="qt-complete"
            aria-label={`Complete ${task.title}`}
            onClick={() =>
              change({ kind: "status", id: task.id, status: "done" })
            }
          >
            <Check size={15} />
          </button>
        )}
        <div>
          <div className="qt-tags">
            {today && index < 3 && (
              <span className="qt-priority">Priority {index + 1}</span>
            )}
            <span>
              {task.provenance === "commitment"
                ? "Explicit commitment"
                : task.provenance === "inferred"
                  ? "Inferred next step"
                  : "Added by you"}
            </span>
          </div>
          <h3>{task.title}</h3>
        </div>
        {today && (
          <div className="qt-order">
            <button
              disabled={index === 0}
              aria-label={`Move ${task.title} up`}
              onClick={() =>
                change({ kind: "move", id: task.id, direction: "up" })
              }
            >
              <ArrowUp size={14} />
            </button>
            <button
              disabled={index === total - 1}
              aria-label={`Move ${task.title} down`}
              onClick={() =>
                change({ kind: "move", id: task.id, direction: "down" })
              }
            >
              <ArrowDown size={14} />
            </button>
          </div>
        )}
      </div>
      {task.details && (
        <p className="qt-reason">
          <strong>
            {task.provenance === "manual" ? "Details" : "Why this matters"}
          </strong>{" "}
          {task.details}
        </p>
      )}
      <div className="qt-tags">
        {task.dueAt && (
          <span
            className={
              task.dueAt < snapshot.day && task.status !== "done"
                ? "qt-overdue"
                : ""
            }
          >
            Deadline {date(task.dueAt)}
          </span>
        )}
        {today && task.plannedDay! < snapshot.day && (
          <span>Carried from {date(task.plannedDay!)}</span>
        )}
        {!today && task.status === "todo" && (
          <span>
            {task.plannedDay ? `Planned ${date(task.plannedDay)}` : "For later"}
          </span>
        )}
        {task.goalIds
          .map((id) =>
            snapshot.preferences.goals.find((goal) => goal.id === id),
          )
          .filter(Boolean)
          .map((goal) => (
            <span key={goal!.id}>{goal!.text}</span>
          ))}
      </div>
      {!!task.evidence.length && (
        <details className="qt-evidence">
          <summary>Supporting context · {task.evidence.length}</summary>
          {task.evidence.map((source) => (
            <blockquote key={source.id}>
              <strong>{source.title}</strong>
              <small>
                {source.kind === "assistant"
                  ? "AI reply · supporting context"
                  : source.kind === "desktop"
                    ? "Desktop observation"
                    : source.kind === "user"
                      ? "Your message"
                      : "Saved note"}{" "}
                · {new Date(source.observedAt).toLocaleString()}
              </small>
              <p>{source.excerpt}</p>
            </blockquote>
          ))}
        </details>
      )}
      <div className="qt-actions">
        {task.status === "suggested" && (
          <>
            <button
              className="qt-primary"
              onClick={() =>
                change({
                  kind: "status",
                  id: task.id,
                  status: "todo",
                  plannedDay: snapshot.day,
                })
              }
            >
              Add to Today
            </button>
            <button
              onClick={() =>
                change({
                  kind: "status",
                  id: task.id,
                  status: "todo",
                  plannedDay: null,
                })
              }
            >
              Save for later
            </button>
            <button
              onClick={() =>
                change({ kind: "status", id: task.id, status: "dismissed" })
              }
            >
              Dismiss
            </button>
          </>
        )}
        {task.status === "todo" && !today && (
          <button
            onClick={() =>
              change({
                kind: "status",
                id: task.id,
                status: "todo",
                plannedDay: snapshot.day,
              })
            }
          >
            Add to Today
          </button>
        )}
        {task.status === "todo" && today && (
          <button
            onClick={() =>
              change({
                kind: "status",
                id: task.id,
                status: "todo",
                plannedDay: null,
              })
            }
          >
            Save for later
          </button>
        )}
        {task.status === "done" && (
          <button
            onClick={() =>
              change({ kind: "status", id: task.id, status: "todo" })
            }
          >
            Undo completion
          </button>
        )}
        {task.status !== "done" && <button onClick={edit}>Edit / defer</button>}
        {task.status === "todo" && (
          <button
            onClick={() => {
              void run(() => window.companion.helpWithTask(task.id), false);
            }}
          >
            <Sparkles size={13} />
            Help with this
          </button>
        )}
        <button onClick={() => change({ kind: "delete", id: task.id })}>
          Delete
        </button>
      </div>
    </article>
  );
}
export default function TodayView() {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DailyTask | "new" | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const identity = useRef<string | null | undefined>(undefined);
  const run: Run = async (work, lock = true) => {
    setError("");
    if (lock) setBusy(true);
    try {
      await work();
      return true;
    } catch (error) {
      setError(
        String(error instanceof Error ? error.message : error).replace(
          /^Error invoking remote method '[^']*':\s*(Error:\s*)?/,
          "",
        ),
      );
      return false;
    } finally {
      if (lock) setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const receive = (value: TodaySnapshot) => {
      if (!active) return;
      if (identity.current !== value.identity) {
        setEditing(null);
        setGoalsOpen(false);
        setError("");
        identity.current = value.identity;
      }
      setSnapshot(value);
    };
    const refresh = () => {
      void window.companion
        .dailySnapshot()
        .then(receive)
        .catch((error) => {
          if (active) setError(error.message);
        });
    };
    const off = window.companion.onDailyChange(receive);
    const offWorkspace = window.workspace.onChange((value) => {
      if (identity.current !== (value.account?.id ?? null)) {
        setSnapshot(null);
        refresh();
      }
    });
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      active = false;
      off();
      offWorkspace();
      clearInterval(timer);
    };
  }, []);
  if (!snapshot?.ready)
    return (
      <section className="qt-view">
        <h1>Today</h1>
        <p role="status">
          {snapshot?.error || error || "Opening your daily list…"}
        </p>
      </section>
    );
  const today = snapshot.tasks.filter(
    (task) =>
      task.status === "todo" &&
      task.plannedDay !== null &&
      task.plannedDay <= snapshot.day,
  );
  const suggested = snapshot.tasks.filter(
    (task) => task.status === "suggested",
  );
  const later = snapshot.tasks.filter(
    (task) =>
      task.status === "todo" &&
      (task.plannedDay === null || task.plannedDay > snapshot.day),
  );
  const completed = snapshot.tasks
    .filter((task) => task.status === "done")
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));
  const doneToday = completed.filter(
    (task) => localDay(new Date(task.completedAt!)) === snapshot.day,
  ).length;
  const cards = (tasks: DailyTask[], isToday = false) =>
    tasks.map((task, index) => (
      <TaskCard
        key={task.id}
        task={task}
        index={index}
        total={tasks.length}
        today={isToday}
        snapshot={snapshot}
        run={run}
        edit={() => setEditing(task)}
      />
    ));
  return (
    <section className="qt-view" aria-label="Daily list">
      <header className="qt-header">
        <div>
          <span className="qt-eyebrow">A little direction for your day</span>
          <h1>Today</h1>
          <p>
            {new Date(`${snapshot.day}T12:00:00`).toLocaleDateString(
              undefined,
              { weekday: "long", month: "long", day: "numeric" },
            )}{" "}
            · {doneToday} completed today
          </p>
        </div>
        <div className="qt-header-actions">
          <button
            onClick={() => {
              void run(() => window.companion.pinToday());
            }}
          >
            Pin as sticky note
          </button>
          <button className="qt-primary" onClick={() => setEditing("new")}>
            <Plus size={15} />
            Add task
          </button>
        </div>
      </header>
      {(error || snapshot.error) && (
        <p role="alert" className="qt-error">
          {error || snapshot.error}
        </p>
      )}
      <fieldset className="qt-content" disabled={busy}>
        <div className="qt-goals">
          <div className="qt-section-heading">
            <h2>Your direction</h2>
            <button onClick={() => setGoalsOpen(!goalsOpen)}>
              {snapshot.preferences.goals.length ? "Edit goals" : "Set goals"}
            </button>
          </div>
          {!goalsOpen &&
            (snapshot.preferences.goals.length ? (
              <ul>
                {snapshot.preferences.goals.map((goal) => (
                  <li key={goal.id}>{goal.text}</li>
                ))}
              </ul>
            ) : (
              <p>Add a few priorities so Quip knows what matters to you.</p>
            ))}
        </div>
        {goalsOpen && (
          <GoalEditor
            goals={snapshot.preferences.goals}
            close={() => setGoalsOpen(false)}
            save={(goals) => {
              void run(async () => {
                await window.companion.configureDaily({
                  ...snapshot.preferences,
                  goals,
                });
                setGoalsOpen(false);
              });
            }}
          />
        )}
        {editing && (
          <TaskEditor
            key={editing === "new" ? "new" : editing.id}
            task={editing === "new" ? null : editing}
            day={snapshot.day}
            goals={snapshot.preferences.goals}
            run={run}
            close={() => setEditing(null)}
          />
        )}
        <section aria-label="Today tasks">
          <div className="qt-section-heading">
            <h2>Your top three &amp; today’s list</h2>
            <span>{today.length}</span>
          </div>
          <p className="qt-caption">
            Start with the first three. Move tasks up or down to choose your
            priorities.
          </p>
          {today.length ? (
            cards(today, true)
          ) : (
            <p className="qt-empty">
              Room for what matters. Add a task or choose a suggestion below.
            </p>
          )}
        </section>
        <section aria-label="Suggested tasks">
          <div className="qt-section-heading">
            <h2>Suggested</h2>
            <span>{suggested.length}</span>
          </div>
          <div className="qt-suggestion-controls">
            <label className="qt-check">
              <input
                type="checkbox"
                checked={snapshot.preferences.enabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setSnapshot(current => current ? { ...current, preferences: { ...current.preferences, enabled } } : current);
                  void run(() => window.companion.configureDaily({ ...snapshot.preferences, enabled })).then(saved => {
                    if (!saved) setSnapshot(current => current?.identity === snapshot.identity ? { ...current, preferences: snapshot.preferences } : current);
                  });
                }}
              />
              Suggest tasks from my activity
            </label>
            <p className="qt-caption">
              Quip reviews selected apps’ visible text, your messages, and saved
              notes. Relevant excerpts go to your selected AI provider.
              Suggestions stay here until you choose them.
            </p>
            <div className="qt-actions">
              <button
                disabled={!snapshot.preferences.enabled || snapshot.refreshing}
                onClick={() => {
                  void run(() => window.companion.refreshDaily(), false);
                }}
              >
                <RefreshCw size={13} />
                {snapshot.refreshing
                  ? "Reviewing activity…"
                  : "Refresh suggestions"}
              </button>
              <small role="status">{snapshot.status}</small>
            </div>
            <small>
              {snapshot.lastRefreshAt
                ? `Last reviewed ${new Date(snapshot.lastRefreshAt).toLocaleString()}`
                : "No activity reviewed yet."}
            </small>
          </div>
          {suggested.length ? (
            cards(suggested)
          ) : (
            <p className="qt-empty">
              {snapshot.preferences.enabled
                ? "Useful next steps will appear as Quip finds supporting context. You can keep adding tasks yourself."
                : "Enable suggestions when you want help finding your next steps."}
            </p>
          )}
        </section>
        <section aria-label="Later tasks">
          <div className="qt-section-heading">
            <h2>Later</h2>
            <span>{later.length}</span>
          </div>
          {later.length ? (
            cards(later)
          ) : (
            <p className="qt-empty">Tasks you defer will wait here.</p>
          )}
        </section>
        <details className="qt-completed">
          <summary>Completed · {completed.length}</summary>
          {cards(completed)}
        </details>
      </fieldset>
      <footer className="qt-footer">
        Saved on this Mac · Only you mark tasks complete.
      </footer>
    </section>
  );
}
