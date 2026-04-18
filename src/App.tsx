import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { load, Store } from "@tauri-apps/plugin-store";

interface ColorPreset {
  id: string;
  label: string;
  dark: string;
  light: string;
}

const COLOR_PRESETS: ColorPreset[] = [
  { id: "purple", label: "Lila",    dark: "#a78bfa", light: "#7c3aed" },
  { id: "teal",   label: "Türkis",  dark: "#2dd4bf", light: "#0d9488" },
  { id: "blue",   label: "Blau",    dark: "#60a5fa", light: "#2563eb" },
  { id: "orange", label: "Orange",  dark: "#fb923c", light: "#ea580c" },
  { id: "pink",   label: "Pink",    dark: "#f472b6", light: "#db2777" },
  { id: "green",  label: "Grün",    dark: "#4ade80", light: "#16a34a" },
  { id: "red",    label: "Rot",     dark: "#f87171", light: "#dc2626" },
  { id: "yellow", label: "Gelb",    dark: "#fbbf24", light: "#b45309" },
  { id: "cyan",   label: "Cyan",    dark: "#22d3ee", light: "#0891b2" },
  { id: "rose",   label: "Rose",    dark: "#fb7185", light: "#e11d48" },
];

function applyAccent(presetId: string, isDark: boolean) {
  const preset = COLOR_PRESETS.find((p) => p.id === presetId) ?? COLOR_PRESETS[0];
  document.documentElement.style.setProperty("--accent", isDark ? preset.dark : preset.light);
}

// Apply synchronously before first render to avoid flash
applyAccent(
  localStorage.getItem("accentColor") ?? "purple",
  (localStorage.getItem("theme") ?? "dark") === "dark"
);

interface Session {
  id: string;
  startedAt: number;
  endedAt: number;
}

interface Task {
  id: string;
  name: string;
  totalSeconds: number;
  sessions: Session[];
  isRunning: boolean;
  startedAt: number | null;
  archived: boolean;
  archivedAt: number | null;
}

interface AndroidTimer {
  startTimer(taskId: string, taskName: string, startTime: number): void;
  stopTimer(): void;
}

const androidTimer = (): AndroidTimer | null =>
  (window as unknown as { AndroidTimer?: AndroidTimer }).AndroidTimer ?? null;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit", minute: "2-digit",
  });
}

function formatSessionLabel(startedAt: number): string {
  const d = new Date(startedAt);
  return `${WEEKDAYS[d.getDay()]}, ${formatDate(startedAt)}`;
}

function parseTime(value: string): number | null {
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [h, m, s] = parts;
  if (m >= 60 || s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

function getDisplaySeconds(task: Task, now: number): number {
  if (task.isRunning && task.startedAt !== null) {
    return task.totalSeconds + Math.floor((now - task.startedAt) / 1000);
  }
  return task.totalSeconds;
}

function syncNotification(tasks: Task[]) {
  const timer = androidTimer();
  if (!timer) return;
  const running = tasks.filter((t) => t.isRunning && t.startedAt !== null && !t.archived);
  if (running.length === 0) {
    timer.stopTimer();
  } else {
    const latest = running.reduce((a, b) => (a.startedAt! > b.startedAt! ? a : b));
    timer.startTimer(latest.id, latest.name, latest.startedAt!);
  }
}

function migrateTask(t: Task): Task {
  return {
    ...t,
    sessions: t.sessions ?? [],
    archived: t.archived ?? false,
    archivedAt: t.archivedAt ?? null,
  };
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskName, setNewTaskName] = useState("");
  const [now, setNow] = useState(Date.now());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState("");
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : true;
  });
  const [showArchive, setShowArchive] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState(
    () => localStorage.getItem("accentColor") ?? "purple"
  );
  const storeRef = useRef<Store | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    document.body.classList.toggle("light", !isDark);
    localStorage.setItem("theme", isDark ? "dark" : "light");
    applyAccent(selectedColor, isDark);
  }, [isDark, selectedColor]);

  useEffect(() => {
    localStorage.setItem("accentColor", selectedColor);
  }, [selectedColor]);

  useEffect(() => {
    async function init() {
      const store = await load("tasks.json", { autoSave: false, defaults: {} });
      storeRef.current = store;
      const saved = await store.get<Task[]>("tasks");
      if (saved) setTasks(saved.map(migrateTask));
      initialized.current = true;
    }
    init();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!initialized.current || !storeRef.current) return;
    storeRef.current.set("tasks", tasks).then(() => storeRef.current?.save());
    syncNotification(tasks);
  }, [tasks]);

  useEffect(() => {
    function onNotificationStop(e: Event) {
      const { taskId } = (e as CustomEvent<{ taskId: string }>).detail;
      stopTask(taskId);
    }
    window.addEventListener("notification-stop", onNotificationStop);
    return () => window.removeEventListener("notification-stop", onNotificationStop);
  }, []);

  function stopTask(id: string) {
    const timestamp = Date.now();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id || !task.isRunning || task.startedAt === null) return task;
        const elapsed = Math.floor((timestamp - task.startedAt) / 1000);
        const session: Session = { id: crypto.randomUUID(), startedAt: task.startedAt, endedAt: timestamp };
        return { ...task, isRunning: false, startedAt: null, totalSeconds: task.totalSeconds + elapsed, sessions: [...task.sessions, session] };
      })
    );
  }

  function addTask() {
    const name = newTaskName.trim();
    if (!name) return;
    setTasks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, totalSeconds: 0, sessions: [], isRunning: false, startedAt: null, archived: false, archivedAt: null },
    ]);
    setNewTaskName("");
  }

  function toggleTask(id: string) {
    const timestamp = Date.now();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;
        if (task.isRunning && task.startedAt !== null) {
          const elapsed = Math.floor((timestamp - task.startedAt) / 1000);
          const session: Session = { id: crypto.randomUUID(), startedAt: task.startedAt, endedAt: timestamp };
          return { ...task, isRunning: false, startedAt: null, totalSeconds: task.totalSeconds + elapsed, sessions: [...task.sessions, session] };
        }
        return { ...task, isRunning: true, startedAt: timestamp };
      })
    );
  }

  function archiveTask(id: string) {
    const timestamp = Date.now();
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== id) return task;
        if (task.isRunning && task.startedAt !== null) {
          const elapsed = Math.floor((timestamp - task.startedAt) / 1000);
          const session: Session = { id: crypto.randomUUID(), startedAt: task.startedAt, endedAt: timestamp };
          return { ...task, isRunning: false, startedAt: null, totalSeconds: task.totalSeconds + elapsed, sessions: [...task.sessions, session], archived: true, archivedAt: timestamp };
        }
        return { ...task, archived: true, archivedAt: timestamp };
      })
    );
  }

  function restoreTask(id: string) {
    setTasks((prev) =>
      prev.map((task) => task.id === id ? { ...task, archived: false, archivedAt: null } : task)
    );
  }

  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
  }

  function startEditingTime(task: Task) {
    setEditingTimeId(task.id);
    setEditingTimeValue(formatTime(getDisplaySeconds(task, now)));
  }

  function commitTimeEdit(id: string) {
    const seconds = parseTime(editingTimeValue);
    if (seconds !== null) {
      setTasks((prev) =>
        prev.map((task) => {
          if (task.id !== id) return task;
          return { ...task, totalSeconds: seconds, startedAt: task.isRunning ? Date.now() : null };
        })
      );
    }
    setEditingTimeId(null);
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function renderSessions(task: Task) {
    const isExpanded = expandedIds.has(task.id);
    if (!isExpanded) return null;
    const reversed = [...task.sessions].reverse();
    return (
      <div className="sessions-list">
        {task.isRunning && task.startedAt && (
          <div className="session-item session-current">
            <span className="session-label">Läuft gerade</span>
            <span className="session-range">seit {formatClock(task.startedAt)}</span>
            <span className="session-dur">{formatTime(Math.floor((now - task.startedAt) / 1000))}</span>
          </div>
        )}
        {reversed.length === 0 && !task.isRunning && (
          <div className="sessions-empty">Keine Zeitabschnitte aufgezeichnet</div>
        )}
        {reversed.map((s) => {
          const dur = Math.floor((s.endedAt - s.startedAt) / 1000);
          return (
            <div key={s.id} className="session-item">
              <span className="session-label">{formatSessionLabel(s.startedAt)}</span>
              <span className="session-range">{formatClock(s.startedAt)} – {formatClock(s.endedAt)}</span>
              <span className="session-dur">{formatTime(dur)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  function renderTaskRow(task: Task, isArchived = false) {
    const expanded = expandedIds.has(task.id);
    return (
      <div key={task.id} className="task-container">
        <div className={`task-row ${task.isRunning ? "running" : ""} ${isArchived ? "archived-row" : ""}`}>
          <div className="task-name-wrap" onClick={() => toggleExpand(task.id)}>
            <span className={`expand-icon ${expanded ? "open" : ""}`}>▸</span>
            <div className="task-info">
              <span className="task-name">{task.name}</span>
              {isArchived && task.archivedAt && (
                <span className="task-archived-date">{formatDate(task.archivedAt)}</span>
              )}
            </div>
          </div>

          {!isArchived && editingTimeId === task.id ? (
            <input
              className="time-input"
              value={editingTimeValue}
              onChange={(e) => setEditingTimeValue(e.target.value)}
              onBlur={() => commitTimeEdit(task.id)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") commitTimeEdit(task.id);
                if (e.key === "Escape") setEditingTimeId(null);
              }}
              autoFocus
              placeholder="HH:MM:SS"
            />
          ) : (
            <div
              className={`task-time ${isArchived ? "static" : ""}`}
              onClick={!isArchived ? () => startEditingTime(task) : undefined}
              title={!isArchived ? "Klicken zum Bearbeiten" : undefined}
            >
              {formatTime(getDisplaySeconds(task, now))}
            </div>
          )}

          {!isArchived && (
            <button
              className={`btn btn-toggle ${task.isRunning ? "stop" : "start"}`}
              onClick={() => toggleTask(task.id)}
              title={task.isRunning ? "Stoppen" : "Starten"}
            >
              {task.isRunning ? "■" : "▶"}
            </button>
          )}

          {!isArchived && (
            <button className="btn btn-archive" onClick={() => archiveTask(task.id)} title="Abschließen">✓</button>
          )}

          {isArchived && (
            <button className="btn btn-restore" onClick={() => restoreTask(task.id)} title="Wiederherstellen">↩</button>
          )}

          {confirmDeleteId === task.id ? (
            <div className="confirm-delete">
              <span className="confirm-label">Sicher?</span>
              <button className="btn btn-confirm-yes" onClick={() => deleteTask(task.id)}>✓</button>
              <button className="btn btn-confirm-no" onClick={() => setConfirmDeleteId(null)}>✕</button>
            </div>
          ) : (
            <button className="btn btn-delete" onClick={() => setConfirmDeleteId(task.id)} title="Löschen">✕</button>
          )}
        </div>

        {renderSessions(task)}
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => !t.archived);
  const archivedTasks = tasks.filter((t) => t.archived).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  return (
    <div className="app">
      <div className="header">
        <h1 className="title">Timetracker</h1>
        <div className="header-actions">
          <button
            className="btn-theme"
            onClick={() => { setShowColorPicker((s) => !s); }}
            title="Farbe wählen"
          >
            🎨
          </button>
          <button className="btn-theme" onClick={() => setIsDark((d) => !d)} title={isDark ? "Light Mode" : "Dark Mode"}>
            {isDark ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {showColorPicker && (
        <div className="color-picker">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={`color-swatch ${selectedColor === preset.id ? "active" : ""}`}
              style={{ background: isDark ? preset.dark : preset.light }}
              onClick={() => { setSelectedColor(preset.id); setShowColorPicker(false); }}
              title={preset.label}
            />
          ))}
        </div>
      )}

      <div className="add-row">
        <input
          className="add-input"
          type="text"
          placeholder="Neuer Task..."
          value={newTaskName}
          onChange={(e) => setNewTaskName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          autoFocus
        />
        <button className="btn btn-add" onClick={addTask}>+</button>
      </div>

      <div className="task-list">
        {activeTasks.length === 0 && archivedTasks.length === 0 && (
          <p className="empty">Noch keine Tasks. Füge einen hinzu!</p>
        )}

        {activeTasks.map((task) => renderTaskRow(task))}

        {archivedTasks.length > 0 && (
          <div className="archive-section">
            <button className="archive-header" onClick={() => setShowArchive((s) => !s)}>
              <span>Archiv ({archivedTasks.length})</span>
              <span className="archive-chevron">{showArchive ? "▲" : "▼"}</span>
            </button>
            {showArchive && archivedTasks.map((task) => renderTaskRow(task, true))}
          </div>
        )}
      </div>
    </div>
  );
}
