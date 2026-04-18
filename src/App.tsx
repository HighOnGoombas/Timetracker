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
  projectId: string | null;
}

interface Project {
  id: string;
  name: string;
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
    projectId: t.projectId ?? null,
  };
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [moveProjectTaskId, setMoveProjectTaskId] = useState<string | null>(null);
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [editingTimeValue, setEditingTimeValue] = useState("");
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : true;
  });
  const [showArchive, setShowArchive] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState(
    () => localStorage.getItem("accentColor") ?? "purple"
  );
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const storeRef = useRef<Store | null>(null);
  const initialized = useRef(false);
  const taskInputRef = useRef<HTMLInputElement>(null);

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
      const savedProjects = await store.get<Project[]>("projects");
      if (savedProjects) setProjects(savedProjects);
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
    if (!initialized.current || !storeRef.current) return;
    storeRef.current.set("projects", projects).then(() => storeRef.current?.save());
  }, [projects]);

  useEffect(() => {
    function onNotificationStop(e: Event) {
      const { taskId } = (e as CustomEvent<{ taskId: string }>).detail;
      stopTask(taskId);
    }
    window.addEventListener("notification-stop", onNotificationStop);
    return () => window.removeEventListener("notification-stop", onNotificationStop);
  }, []);

  function closeMenu() {
    setOpenMenuId(null);
    setConfirmDeleteId(null);
    setMoveProjectTaskId(null);
  }

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
      { id: crypto.randomUUID(), name, totalSeconds: 0, sessions: [], isRunning: false, startedAt: null, archived: false, archivedAt: null, projectId: newTaskProjectId },
    ]);
    setNewTaskName("");
    taskInputRef.current?.blur();
  }

  function addProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setProjects((prev) => [...prev, { id, name }]);
    setExpandedProjectIds((prev) => new Set([...prev, id]));
    setNewProjectName("");
    setShowAddProject(false);
  }

  function deleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setTasks((prev) => prev.map((t) => t.projectId === id ? { ...t, projectId: null } : t));
    closeMenu();
  }

  function assignToProject(taskId: string, projectId: string | null) {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, projectId } : t));
  }

  function toggleProjectExpand(id: string) {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
    closeMenu();
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

  function renderTaskMenu(task: Task, isArchived: boolean) {
    return (
      <div className="task-menu">
        <button
          className="btn btn-menu"
          onClick={() => {
            setOpenMenuId(openMenuId === task.id ? null : task.id);
            setConfirmDeleteId(null);
            setMoveProjectTaskId(null);
          }}
        >
          ⋯
        </button>
        {openMenuId === task.id && (
          <div className="menu-dropdown">
            {confirmDeleteId === task.id ? (
              <>
                <span className="menu-confirm-label">Wirklich löschen?</span>
                <button className="menu-item danger" onClick={() => deleteTask(task.id)}>Ja, löschen</button>
                <button className="menu-item" onClick={() => { setConfirmDeleteId(null); closeMenu(); }}>Abbrechen</button>
              </>
            ) : moveProjectTaskId === task.id ? (
              <>
                <span className="menu-confirm-label">Zu Projekt verschieben</span>
                <button className="menu-item" onClick={() => { assignToProject(task.id, null); closeMenu(); }}>
                  {!task.projectId ? "✓ " : ""}Kein Projekt
                </button>
                {projects.map((p) => (
                  <button key={p.id} className="menu-item" onClick={() => { assignToProject(task.id, p.id); closeMenu(); }}>
                    {task.projectId === p.id ? "✓ " : ""}{p.name}
                  </button>
                ))}
                <button className="menu-item" onClick={() => setMoveProjectTaskId(null)}>← Zurück</button>
              </>
            ) : (
              <>
                {!isArchived && projects.length > 0 && (
                  <button className="menu-item" onClick={() => setMoveProjectTaskId(task.id)}>
                    📁 Zu Projekt
                  </button>
                )}
                {!isArchived && (
                  <button className="menu-item" onClick={() => { archiveTask(task.id); closeMenu(); }}>
                    ✓ Abschließen
                  </button>
                )}
                {isArchived && (
                  <button className="menu-item" onClick={() => { restoreTask(task.id); closeMenu(); }}>
                    ↩ Wiederherstellen
                  </button>
                )}
                <button className="menu-item danger" onClick={() => setConfirmDeleteId(task.id)}>
                  ✕ Löschen
                </button>
              </>
            )}
          </div>
        )}
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
              {isArchived && (
                <span className="task-archived-date">
                  {task.archivedAt && formatDate(task.archivedAt)}
                  {task.projectId && projects.find(p => p.id === task.projectId) && (
                    <span className="task-archived-project">
                      {" · "}{projects.find(p => p.id === task.projectId)!.name}
                    </span>
                  )}
                </span>
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

          {renderTaskMenu(task, isArchived)}
        </div>

        {renderSessions(task)}
      </div>
    );
  }

  function renderProjectSection(project: Project) {
    const isExpanded = expandedProjectIds.has(project.id);
    const projectTasks = activeTasks.filter((t) => t.projectId === project.id);
    const totalSeconds = tasks
      .filter((t) => t.projectId === project.id)
      .reduce((sum, t) => sum + getDisplaySeconds(t, now), 0);
    const menuId = `proj-${project.id}`;
    const hasRunning = projectTasks.some((t) => t.isRunning);

    return (
      <div key={project.id} className="project-section">
        <div className={`project-header ${isExpanded && projectTasks.length > 0 ? "expanded" : ""} ${hasRunning ? "running" : ""}`}>
          <div className="project-header-main" onClick={() => toggleProjectExpand(project.id)}>
            <span className={`expand-icon project-expand-icon ${isExpanded ? "open" : ""}`}>▸</span>
            <span className="project-name">{project.name}</span>
            <span className="project-total">{formatTime(totalSeconds)}</span>
          </div>
          <div className="task-menu" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn btn-menu"
              onClick={() => setOpenMenuId(openMenuId === menuId ? null : menuId)}
            >
              ⋯
            </button>
            {openMenuId === menuId && (
              <div className="menu-dropdown">
                <button className="menu-item danger" onClick={() => deleteProject(project.id)}>
                  ✕ Projekt löschen
                </button>
              </div>
            )}
          </div>
        </div>
        {isExpanded && (
          <div className="project-tasks">
            {projectTasks.length === 0 && (
              <p className="empty" style={{ padding: "8px 0" }}>Keine Tasks im Projekt</p>
            )}
            {projectTasks.map((task) => renderTaskRow(task))}
          </div>
        )}
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => !t.archived);
  const ungroupedTasks = activeTasks.filter(
    (t) => !t.projectId || !projects.some((p) => p.id === t.projectId)
  );
  const archivedTasks = tasks.filter((t) => t.archived).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  return (
    <>
      {openMenuId && (
        <div className="menu-backdrop" onClick={closeMenu} />
      )}
      <div className="app">
        <div className="header">
          <h1 className="title">Timetracker</h1>
          <div className="header-actions">
            <button
              className={`btn-theme ${showAddProject ? "active" : ""}`}
              onClick={() => { setShowAddProject((s) => !s); setNewProjectName(""); }}
              title="Neues Projekt"
            >
              📁
            </button>
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

        {showAddProject && (
          <div className="add-row" style={{ marginBottom: 12 }}>
            <input
              className="add-input"
              type="text"
              placeholder="Projektname..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addProject();
                if (e.key === "Escape") setShowAddProject(false);
              }}
              autoFocus
            />
            <button className="btn btn-add" onClick={addProject}>+</button>
          </div>
        )}

        <div className="add-section">
          <div className="add-row">
            <input
              ref={taskInputRef}
              className="add-input"
              type="text"
              placeholder="Neuer Task..."
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              autoFocus={navigator.maxTouchPoints === 0}
            />
            <button className="btn btn-add" onClick={addTask}>+</button>
          </div>
          {projects.length > 0 && (
            <div className="add-row">
              <span className="project-select-label">Projekt:</span>
              <select
                className="project-select"
                value={newTaskProjectId ?? ""}
                onChange={(e) => setNewTaskProjectId(e.target.value || null)}
              >
                <option value="">Kein Projekt</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="task-list">
          {activeTasks.length === 0 && archivedTasks.length === 0 && projects.length === 0 && (
            <p className="empty">Noch keine Tasks. Füge einen hinzu!</p>
          )}

          {projects.map((project) => renderProjectSection(project))}

          {ungroupedTasks.map((task) => renderTaskRow(task))}

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
    </>
  );
}
