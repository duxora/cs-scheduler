import { useState, useMemo, useCallback } from 'react'
import { useTaskBoard } from '../hooks/useTaskBoard'
import { useSortCriteria } from '../hooks/useSortCriteria'
import { useUrlParam } from '../hooks/useUrlParam'
import { Status, Phases } from '../lib/tokens'
import type { PhaseKey } from '../lib/tokens'
import { applySorts } from '../lib/sort'
import TaskDetailDrawer from './TaskDetailDrawer'
import BulkActions from './BulkActions'
import DomainMapModal from './DomainMapModal'
import MisplacedBanner from './MisplacedBanner'
import ProjectCard from './ProjectCard'
import PhaseChip from './PhaseChip'
import SortBuilder from './SortBuilder'
import TaskRow from './TaskRow'
import InitiativesStrip from './InitiativesStrip'
import { EmptyState, LoadingState, ErrorState } from './TaskListStates'
import { CloseIcon, SettingsIcon, CheckTaskIcon, ExternalLinkIcon } from './ui/icons'
import FilterBar from './common/FilterBar'

// ── main component ─────────────────────────────────────────────────────────

export default function TaskBoard() {
  const [projectFilter, setProjectFilter] = useUrlParam('project')
  const [statusFilter, setStatusFilter]   = useUrlParam('status')
  const [phaseFilterRaw, setPhaseFilter]  = useUrlParam('phase')
  const phaseFilter = phaseFilterRaw as PhaseKey | ''
  const [search, setSearch]               = useUrlParam('q')
  const [drawerTaskRaw, setDrawerTaskRaw] = useUrlParam('task')
  const drawerTaskId = drawerTaskRaw ? Number(drawerTaskRaw) : null
  const setDrawerTaskId = useCallback(
    (id: number | null) => setDrawerTaskRaw(id == null ? '' : String(id)),
    [setDrawerTaskRaw],
  )
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(new Set())
  const [domainMapOpen, setDomainMapOpen] = useState(false)
  const [showIdle, setShowIdle] = useState(false)

  const sortController = useSortCriteria()
  const { tasks, projects, tasksError, projectsError, mutateTasks } = useTaskBoard(projectFilter, statusFilter)

  const handleDeleteTask = useCallback(async (id: number) => {
    await fetch(`/workflow/api/tasks/${id}`, { method: 'DELETE' })
    await mutateTasks()
  }, [mutateTasks])

  const { visibleProjects, idleCount } = useMemo(() => {
    const all = projects ?? []
    // A project is "idle" when no work is in flight. Always keep the currently
    // selected project visible so a URL-restored filter doesn't silently vanish.
    const visible = all.filter((p) => {
      if (showIdle) return true
      if (p.project_id === projectFilter) return true
      return p.open_count > 0 || p.in_progress_count > 0
    })
    const idle = all.length - all.filter((p) => p.open_count > 0 || p.in_progress_count > 0).length
    return { visibleProjects: visible, idleCount: idle }
  }, [projects, showIdle, projectFilter])

  const allCounts = useMemo(() => {
    if (!projects) return { open: 0, inProgress: 0, done: 0 }
    return projects.reduce(
      (acc, p) => ({
        open:       acc.open       + p.open_count,
        inProgress: acc.inProgress + p.in_progress_count,
        done:       acc.done       + p.done_count,
      }),
      { open: 0, inProgress: 0, done: 0 },
    )
  }, [projects])

  const phaseCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of tasks ?? []) counts[t.phase] = (counts[t.phase] ?? 0) + 1
    return counts
  }, [tasks])

  const visibleTasks = useMemo(() => {
    let result = tasks ?? []
    if (phaseFilter) result = result.filter((t) => t.phase === phaseFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((t) => String(t.id).includes(q) || t.title.toLowerCase().includes(q))
    }
    return applySorts(result, sortController.criteria)
  }, [tasks, phaseFilter, search, sortController.criteria])

  const handleSelectTask = useCallback((id: number, checked: boolean) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const allVisibleSelected  = visibleTasks.length > 0 && visibleTasks.every((t) => selectedTasks.has(t.id))
  const someVisibleSelected = visibleTasks.some((t) => selectedTasks.has(t.id))

  const handleSelectAll = (checked: boolean) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev)
      for (const t of visibleTasks) {
        if (checked) next.add(t.id)
        else next.delete(t.id)
      }
      return next
    })
  }

  const activeFilters = [phaseFilter, search.trim()].filter(Boolean).length

  return (
    <div className="flex flex-col h-full text-slate-100" style={{ background: 'var(--wf-bg-base)' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="relative flex items-center justify-between px-5 pl-12 lg:pl-5 py-3 shrink-0 border-b"
        style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-blue-500/30 via-purple-500/20 to-transparent" />

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
              <CheckTaskIcon />
            </div>
            <h1 className="text-sm font-bold text-white tracking-tight">Dev Workflow</h1>
          </div>
          {(tasksError || projectsError) && (
            <span className="text-[10px] text-red-300 bg-red-900/50 px-2 py-0.5 rounded-full border border-red-700/60">
              API error
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setDomainMapOpen(true)}
            className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-700/50 rounded-md transition-all"
            aria-label="Domain map settings"
            title="Domain Map"
          >
            <SettingsIcon />
          </button>
          <div className="flex items-center gap-3 border-l border-slate-700/60 pl-4">
            <a href="http://localhost:7070" target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-slate-400 hover:text-blue-300 font-medium transition-colors flex items-center gap-1">
              Dev Site
              <ExternalLinkIcon />
            </a>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-slate-400 hover:text-blue-300 font-medium transition-colors flex items-center gap-1">
              GitHub
              <ExternalLinkIcon />
            </a>
          </div>
        </div>
      </div>

      {/* ── Initiatives & Epics hero strip ─────────────────────────────── */}
      <InitiativesStrip projectFilter={projectFilter} />

      {/* ── Project cards ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 px-4 py-3 shrink-0 border-b" style={{ borderColor: 'var(--wf-border)' }}>
        <ProjectCard
          label="All projects"
          open={allCounts.open}
          inProgress={allCounts.inProgress}
          done={allCounts.done}
          active={projectFilter === ''}
          onClick={() => setProjectFilter('')}
        />
        {visibleProjects.map((p) => (
          <ProjectCard
            key={p.project_id}
            label={p.project_name}
            open={p.open_count}
            inProgress={p.in_progress_count}
            done={p.done_count}
            active={projectFilter === p.project_id}
            onClick={() => setProjectFilter(projectFilter === p.project_id ? '' : p.project_id)}
          />
        ))}
        {idleCount > 0 && (
          <button
            type="button"
            onClick={() => setShowIdle((v) => !v)}
            className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 rounded-lg border border-slate-700/50 hover:border-slate-500/50 self-center transition-all"
            title={showIdle ? 'Hide idle projects (no open or in-progress tasks)' : 'Show idle projects (no open or in-progress tasks)'}
          >
            {showIdle ? `Hide ${idleCount} idle` : `+ ${idleCount} idle`}
          </button>
        )}
        {projectsError && (
          <span className="text-[11px] text-red-300 self-center">Failed to load projects</span>
        )}
      </div>

      {/* ── Phase strip ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 shrink-0 border-b" style={{ borderColor: 'var(--wf-border)' }}>
        <span className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest mr-1 shrink-0">Phase</span>
        {Phases.map((phase) => (
          <PhaseChip
            key={phase.key}
            phase={phase}
            count={phaseCounts[phase.key] ?? 0}
            active={phaseFilter === phase.key}
            onClick={() => setPhaseFilter(phaseFilter === phase.key ? '' : (phase.key as PhaseKey))}
          />
        ))}
        {phaseFilter && (
          <button
            onClick={() => setPhaseFilter('')}
            className="text-[11px] text-slate-300 hover:text-white ml-1 transition-colors shrink-0 flex items-center gap-0.5"
          >
            <CloseIcon size={10} />
            clear
          </button>
        )}
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <FilterBar style={{ background: 'var(--wf-bg-surface)', borderColor: 'var(--wf-border)' }}>
        <FilterBar.Search
          value={search}
          onChange={setSearch}
          placeholder="Search tasks…"
          onClear={() => setSearch('')}
        />

        {/* Project select */}
        <FilterBar.Select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          selectClassName="text-xs bg-slate-800/80 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-slate-300 focus:border-blue-500/60 focus:outline-none transition-all"
        >
          <option value="">All Projects</option>
          {visibleProjects.map((p) => (
            <option key={p.project_id} value={p.project_id}>{p.project_name}</option>
          ))}
        </FilterBar.Select>

        {/* Status select */}
        <FilterBar.Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          selectClassName="text-xs bg-slate-800/80 border border-slate-700/60 rounded-lg px-2.5 py-1.5 text-slate-300 focus:border-blue-500/60 focus:outline-none transition-all"
        >
          {Status.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </FilterBar.Select>

        {/* Clear filters pill */}
        {activeFilters > 0 && (
          <button
            onClick={() => { setSearch(''); setPhaseFilter('') }}
            className="text-[11px] text-slate-300 hover:text-red-400 px-2 py-1 rounded-full border border-slate-700/50 hover:border-red-800/50 transition-all flex items-center gap-1"
          >
            <CloseIcon size={9} />
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}

        <FilterBar.Count className="text-slate-300 font-medium">
          {visibleTasks.length} task{visibleTasks.length !== 1 ? 's' : ''}
        </FilterBar.Count>
      </FilterBar>

      {/* ── Sort builder ───────────────────────────────────────────────── */}
      <SortBuilder controller={sortController} />

      {/* ── Misplaced banner ───────────────────────────────────────────── */}
      <MisplacedBanner projectFilter={projectFilter} />

      {/* ── Task list ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2">

        {/* Column header */}
        {visibleTasks.length > 0 && (
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 mb-1">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected }}
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="shrink-0 accent-blue-400 cursor-pointer"
              aria-label="Select all visible tasks"
            />
            <span className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest w-10 text-right">#</span>
            <span className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest flex-1">
              {selectedTasks.size > 0
                ? <span className="text-blue-400 normal-case tracking-normal font-medium">{selectedTasks.size} selected</span>
                : 'Task'
              }
            </span>
            <span className="text-[11px] text-slate-200 font-semibold uppercase tracking-widest shrink-0 w-10 text-center">
              Actions
            </span>
          </div>
        )}

        {/* States */}
        {tasks === undefined && !tasksError && <LoadingState />}
        {tasksError && <ErrorState />}
        {tasks !== undefined && visibleTasks.length === 0 && !tasksError && (
          <EmptyState search={search} phaseFilter={phaseFilter} />
        )}

        {/* Rows */}
        <div className="flex flex-col gap-px">
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={selectedTasks.has(task.id)}
              onSelect={handleSelectTask}
              onOpenDetail={(id) => setDrawerTaskId(drawerTaskId === id ? null : id)}
              onDelete={handleDeleteTask}
            />
          ))}
        </div>
      </div>

      {/* ── Drawers / modals ───────────────────────────────────────────── */}
      <TaskDetailDrawer
        taskId={drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onDelete={async (id) => {
          await handleDeleteTask(id)
          setDrawerTaskId(null)
        }}
        onNavigate={setDrawerTaskId}
      />

      <BulkActions
        selectedIds={selectedTasks}
        projects={projects ?? []}
        onClearSelection={() => setSelectedTasks(new Set())}
      />

      {domainMapOpen && (
        <DomainMapModal
          projects={projects ?? []}
          onClose={() => setDomainMapOpen(false)}
        />
      )}
    </div>
  )
}
