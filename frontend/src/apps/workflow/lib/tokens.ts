/**
 * Workflow design tokens — single source of truth for all visual semantics.
 *
 * Rules:
 *  - Add a token here first, then use it in components.
 *  - Never hard-code a Tailwind class that encodes priority/status/phase meaning
 *    directly in a component. Always import from here.
 *  - `fallback` values cover unknown/future values gracefully.
 */

// ── Priority ───────────────────────────────────────────────────────────────

export const Priority = {
  /** Canonical sort order — lower = higher urgency */
  order: {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
  },

  /** Left-border stripe on task rows — primary scan signal */
  stripe: {
    critical: 'border-l-red-500',
    high:     'border-l-orange-500',
    medium:   'border-l-yellow-500/70',
    low:      'border-l-slate-600/40',
  },

  /** Filled dot beside task title */
  dot: {
    critical: 'bg-red-500',
    high:     'bg-orange-500',
    medium:   'bg-yellow-500',
    low:      'bg-slate-600',
  },

  /** Muted text label (e.g., "critical" floating at row end) */
  label: {
    critical: 'text-red-400',
    high:     'text-orange-400',
    medium:   'text-yellow-400',
    low:      'text-slate-400',
  },

  /** Pill/badge used in detail views and meta rows */
  badge: {
    critical: 'bg-red-900/60 text-red-300 border border-red-700/50',
    high:     'bg-orange-900/60 text-orange-300 border border-orange-700/50',
    medium:   'bg-yellow-900/60 text-yellow-300 border border-yellow-700/50',
    low:      'bg-slate-800/60 text-slate-400 border border-slate-700/50',
  },

  /** Human-readable display strings */
  display: {
    critical: 'Critical',
    high:     'High',
    medium:   'Medium',
    low:      'Low',
  },

  /** Fallbacks for unknown/future priority values */
  fallback: {
    stripe:  'border-l-slate-600/40',
    dot:     'bg-slate-600',
    label:   'text-slate-400',
    badge:   'bg-slate-800/60 text-slate-400 border border-slate-700/50',
    display: 'Unknown',
  },
} as const

// ── Status ─────────────────────────────────────────────────────────────────

export const Status = {
  /**
   * Canonical sort order — lower = surfaces first.
   * Reflects "what needs my attention now" rather than alphabetical order:
   * actively-worked first, then ready-to-pick, then waiting, then resolved.
   */
  order: {
    in_progress: 0,
    open:        1,
    backlog:     2,
    done:        3,
  },

  /** Pill/badge for inline and detail view use */
  badge: {
    open:        'bg-blue-900/60 text-blue-300 border border-blue-700/50',
    in_progress: 'bg-amber-900/60 text-amber-300 border border-amber-700/50',
    backlog:     'bg-indigo-900/60 text-indigo-300 border border-indigo-700/50',
    done:        'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50',
  },

  /** Human-readable display strings */
  display: {
    open:        'Open',
    in_progress: 'In Progress',
    backlog:     'Backlog',
    done:        'Done',
  },

  /** Filter dropdown options */
  options: [
    { value: '',            label: 'Active' },
    { value: 'backlog',     label: 'Backlog only' },
    { value: 'open',        label: 'Open only' },
    { value: 'in_progress', label: 'In Progress only' },
    { value: 'done',        label: 'Done only' },
    { value: 'all',         label: 'All statuses' },
  ],

  /** Fallback for unknown/future status values */
  fallback: {
    badge:   'bg-slate-800/60 text-slate-400 border border-slate-700/50',
    display: 'Unknown',
  },
} as const

// ── Type ───────────────────────────────────────────────────────────────────
//
// Task type hierarchy — parent-capable (initiative, epic) and leaves (task,
// feature, bug, chore). Mirrors backlog/src/models/task.ts. Keep the map
// structure parallel to Priority/Status so the lookup-with-fallback pattern
// transfers directly.

export const Type = {
  /** Parent-capable types — containers, not claimable work */
  parents: ['initiative', 'epic'] as const,
  /** Leaf types — claimable units of work */
  leaves: ['task', 'feature', 'bug', 'chore'] as const,

  /** Pill/badge for inline + detail meta rows */
  badge: {
    initiative: 'bg-purple-900/60 text-purple-300 border border-purple-700/50',
    epic:       'bg-indigo-900/60 text-indigo-300 border border-indigo-700/50',
    task:       'bg-slate-800/60 text-slate-300 border border-slate-700/50',
    feature:    'bg-blue-900/60 text-blue-300 border border-blue-700/50',
    bug:        'bg-red-900/60 text-red-300 border border-red-700/50',
    chore:      'bg-teal-900/60 text-teal-300 border border-teal-700/50',
  },

  /** Filled dot — compact visual signal next to titles */
  dot: {
    initiative: 'bg-purple-400',
    epic:       'bg-indigo-400',
    task:       'bg-slate-400',
    feature:    'bg-blue-400',
    bug:        'bg-red-400',
    chore:      'bg-teal-400',
  },

  /** Muted text label */
  label: {
    initiative: 'text-purple-300',
    epic:       'text-indigo-300',
    task:       'text-slate-300',
    feature:    'text-blue-300',
    bug:        'text-red-300',
    chore:      'text-teal-300',
  },

  /** Human-readable display strings */
  display: {
    initiative: 'Initiative',
    epic:       'Epic',
    task:       'Task',
    feature:    'Feature',
    bug:        'Bug',
    chore:      'Chore',
  },

  /** Fallbacks for unknown/future type values */
  fallback: {
    badge:   'bg-slate-800/60 text-slate-400 border border-slate-700/50',
    dot:     'bg-slate-500',
    label:   'text-slate-400',
    display: 'Unknown',
  },
} as const

/** True if the type is parent-capable (can contain children). */
export function isParentType(type: string): boolean {
  return (Type.parents as readonly string[]).includes(type)
}

// ── Phase ──────────────────────────────────────────────────────────────────

export const Phases = [
  { key: 'intake',    label: 'Intake',    color: 'text-blue-300 bg-blue-900/40 border-blue-700/60',     dot: 'bg-blue-400'    },
  { key: 'backlog',   label: 'Backlog',   color: 'text-indigo-300 bg-indigo-900/40 border-indigo-700/60', dot: 'bg-indigo-400' },
  { key: 'implement', label: 'Implement', color: 'text-emerald-300 bg-emerald-900/40 border-emerald-700/60', dot: 'bg-emerald-400' },
  { key: 'pr_ci',     label: 'PR / CI',   color: 'text-amber-300 bg-amber-900/40 border-amber-700/60',   dot: 'bg-amber-400'   },
  { key: 'review',    label: 'Review',    color: 'text-orange-300 bg-orange-900/40 border-orange-700/60', dot: 'bg-orange-400' },
  { key: 'deploy',    label: 'Deploy',    color: 'text-purple-300 bg-purple-900/40 border-purple-700/60', dot: 'bg-purple-400' },
  { key: 'verify',    label: 'Verify',    color: 'text-teal-300 bg-teal-900/40 border-teal-700/60',      dot: 'bg-teal-400'    },
  { key: 'close',     label: 'Close',     color: 'text-gray-400 bg-gray-800/40 border-gray-600/60',      dot: 'bg-gray-500'    },
] as const

export type PhaseKey = (typeof Phases)[number]['key']

// ── Sort fields ────────────────────────────────────────────────────────────
//
// Single source of truth for sortable columns. Adding a new sortable field
// means: (1) extend the SortFieldKey union, (2) add it here, (3) handle the
// extraction in lib/sort.ts. Components read display strings from this map.

export type SortFieldKey = 'id' | 'created_at' | 'updated_at' | 'status' | 'title' | 'priority'
export type SortDirection = 'asc' | 'desc'

export interface SortFieldDef {
  key: SortFieldKey
  /** Short label used inside pills */
  label: string
  /** Longer label used in the "+ Add sort" menu */
  menuLabel: string
  /** Default direction when this field is added without an explicit one */
  defaultDir: SortDirection
}

export const SortFields: readonly SortFieldDef[] = [
  { key: 'status',     label: 'Status',   menuLabel: 'Status (workflow order)', defaultDir: 'asc'  },
  { key: 'priority',   label: 'Priority', menuLabel: 'Priority',                defaultDir: 'asc'  },
  { key: 'updated_at', label: 'Updated',  menuLabel: 'Last updated',            defaultDir: 'desc' },
  { key: 'created_at', label: 'Created',  menuLabel: 'Created date',            defaultDir: 'desc' },
  { key: 'id',         label: 'ID',       menuLabel: 'Ticket ID',               defaultDir: 'desc' },
  { key: 'title',      label: 'Name',     menuLabel: 'Name (A → Z)',            defaultDir: 'asc'  },
] as const

export const SortFieldMap: Record<SortFieldKey, SortFieldDef> = SortFields.reduce(
  (acc, f) => { acc[f.key] = f; return acc },
  {} as Record<SortFieldKey, SortFieldDef>,
)

// ── Context (life area) ────────────────────────────────────────────────────
//
// Classifies projects/epics/tasks by life area. Mirrors the `context` column
// added in backlog/src/models/{project,task}.ts.

export const ContextToken = {
  order: {
    work: 0,
    family: 1,
    personal: 2,
  },

  /** Pill/badge (detail + filter) */
  badge: {
    work:     'bg-sky-900/60 text-sky-300 border border-sky-700/50',
    family:   'bg-rose-900/60 text-rose-300 border border-rose-700/50',
    personal: 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50',
  },

  /** Filled dot beside titles */
  dot: {
    work:     'bg-sky-400',
    family:   'bg-rose-400',
    personal: 'bg-emerald-400',
  },

  /** Section-accent color for grouped lists */
  accent: {
    work:     'text-sky-300',
    family:   'text-rose-300',
    personal: 'text-emerald-300',
  },

  /** Human-readable display strings */
  display: {
    work:     'Work',
    family:   'Family',
    personal: 'Personal',
  },

  /** Icon glyph (emoji-free — use a short symbol) */
  symbol: {
    work:     'W',
    family:   'F',
    personal: 'P',
  },

  /** Fallback for unset/unknown */
  fallback: {
    badge:   'bg-slate-800/60 text-slate-400 border border-slate-700/50',
    dot:     'bg-slate-600',
    accent:  'text-slate-400',
    display: 'Unclassified',
    symbol:  '·',
  },
} as const

export type ContextKey = keyof typeof ContextToken.display
export const CONTEXT_KEYS: readonly ContextKey[] = ['work', 'family', 'personal'] as const

// ── Mode (solo / team) ─────────────────────────────────────────────────────
//
// Project-level working mode. Solo = single dev drives the project; Team =
// multiple contributors (affects review/PR gating downstream).

export const ModeToken = {
  badge: {
    solo: 'bg-violet-900/60 text-violet-300 border border-violet-700/50',
    team: 'bg-cyan-900/60 text-cyan-300 border border-cyan-700/50',
  },
  display: {
    solo: 'Solo',
    team: 'Team',
  },
  fallback: {
    badge:   'bg-slate-800/60 text-slate-400 border border-slate-700/50',
    display: 'Unset',
  },
} as const

export type ModeKey = keyof typeof ModeToken.display
export const MODE_KEYS: readonly ModeKey[] = ['solo', 'team'] as const
