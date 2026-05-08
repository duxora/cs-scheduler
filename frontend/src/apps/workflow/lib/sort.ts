/**
 * Generic multi-criteria sort — shared across tasks, projects, epics.
 *
 * Design:
 *  - Pure functions — no React, no DOM, easy to unit test.
 *  - Stable: original index is the final tiebreaker so equal rows keep their
 *    incoming order across re-sorts.
 *  - Sorting NEVER hides rows — only reorders them.
 *  - Unknown values deterministically sort to the end.
 */

import { Priority, Status } from './tokens'
import type {
  SortDirection,
  SortFieldKey,
  ProjectSortFieldKey,
  EpicSortFieldKey,
} from './tokens'
import type { Task, ProjectInsights, RoadmapItem } from '../types'

export interface SortCriterion<F extends string = string> {
  field: F
  dir: SortDirection
}

export type SortExtractor<T, F extends string> = (row: T, field: F) => number | string

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Apply an ordered list of sort criteria to a row array.
 * Returns a new array — does NOT mutate input.
 */
export function applySortsGeneric<T, F extends string>(
  rows: readonly T[],
  criteria: readonly SortCriterion<F>[],
  extract: SortExtractor<T, F>,
): T[] {
  if (rows.length === 0) return []
  if (criteria.length === 0) return rows.slice()

  const indexed = rows.map((row, index) => ({ row, index }))

  indexed.sort((a, b) => {
    for (const c of criteria) {
      const av = extract(a.row, c.field)
      const bv = extract(b.row, c.field)
      const cmp = compareValues(av, bv)
      if (cmp !== 0) return c.dir === 'asc' ? cmp : -cmp
    }
    return a.index - b.index
  })

  return indexed.map((x) => x.row)
}

// ── URL serialization ─────────────────────────────────────────────────────
//
// Format: `field:dir,field:dir` (e.g. `priority:asc,updated_at:desc`).

export function serializeSort<F extends string>(criteria: readonly SortCriterion<F>[]): string {
  return criteria.map((c) => `${c.field}:${c.dir}`).join(',')
}

export function parseSort<F extends string>(
  raw: string | null | undefined,
  validFields: ReadonlySet<F>,
): SortCriterion<F>[] {
  if (!raw) return []
  const out: SortCriterion<F>[] = []
  const seen = new Set<F>()
  for (const part of raw.split(',')) {
    const [field, dir] = part.split(':') as [string, string | undefined]
    const f = field as F
    if (!validFields.has(f)) continue
    if (seen.has(f)) continue
    const direction: SortDirection = dir === 'desc' ? 'desc' : 'asc'
    out.push({ field: f, dir: direction })
    seen.add(f)
  }
  return out
}

// ── Task sort ─────────────────────────────────────────────────────────────

/** Default sort applied to the task list when user has not configured anything. */
export const DEFAULT_SORT: readonly SortCriterion<SortFieldKey>[] = [
  { field: 'priority',   dir: 'asc'  },
  { field: 'status',     dir: 'asc'  },
  { field: 'updated_at', dir: 'desc' },
]

function extractTask(task: Task, field: SortFieldKey): number | string {
  switch (field) {
    case 'id':
      return task.id
    case 'created_at':
    case 'updated_at': {
      const raw = task[field]
      if (!raw) return Number.NEGATIVE_INFINITY
      const t = Date.parse(raw)
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
    }
    case 'priority': {
      const order = Priority.order as Record<string, number>
      return Object.hasOwn(order, task.priority) ? order[task.priority]! : 99
    }
    case 'status': {
      const order = Status.order as Record<string, number>
      return Object.hasOwn(order, task.status) ? order[task.status]! : 99
    }
    case 'title':
      return task.title.toLowerCase()
  }
}

export function applySorts(
  tasks: readonly Task[],
  criteria: readonly SortCriterion<SortFieldKey>[],
): Task[] {
  return applySortsGeneric(tasks, criteria, extractTask)
}

// ── Project sort ──────────────────────────────────────────────────────────

export const PROJECT_DEFAULT_SORT: readonly SortCriterion<ProjectSortFieldKey>[] = [
  { field: 'priority',      dir: 'asc'  },
  { field: 'last_activity', dir: 'desc' },
]

function extractProject(p: ProjectInsights, field: ProjectSortFieldKey): number | string {
  switch (field) {
    case 'priority': {
      const order = Priority.order as Record<string, number>
      const value = p.priority ?? p.top_priority ?? ''
      return Object.hasOwn(order, value) ? order[value]! : 99
    }
    case 'name':
      return p.project_name.toLowerCase()
    case 'last_activity': {
      if (!p.last_activity) return Number.NEGATIVE_INFINITY
      const t = Date.parse(p.last_activity)
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
    }
    case 'wip':
      return p.in_progress_count
    case 'open':
      return p.open_count
    case 'overdue':
      return p.overdue_count
    case 'done_14d':
      return p.done_14d
  }
}

export function applyProjectSorts(
  items: readonly ProjectInsights[],
  criteria: readonly SortCriterion<ProjectSortFieldKey>[],
): ProjectInsights[] {
  return applySortsGeneric(items, criteria, extractProject)
}

// ── Epic sort ─────────────────────────────────────────────────────────────

export const EPIC_DEFAULT_SORT: readonly SortCriterion<EpicSortFieldKey>[] = [
  { field: 'priority',   dir: 'asc'  },
  { field: 'updated_at', dir: 'desc' },
]

function extractEpic(e: RoadmapItem, field: EpicSortFieldKey): number | string {
  switch (field) {
    case 'priority': {
      const order = Priority.order as Record<string, number>
      return Object.hasOwn(order, e.priority) ? order[e.priority]! : 99
    }
    case 'title':
      return e.title.toLowerCase()
    case 'status': {
      const order = Status.order as Record<string, number>
      return Object.hasOwn(order, e.status) ? order[e.status]! : 99
    }
    case 'updated_at':
    case 'created_at': {
      const raw = e[field]
      if (!raw) return Number.NEGATIVE_INFINITY
      const t = Date.parse(raw)
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
    }
    case 'progress':
      return e.progress?.percent ?? -1
    case 'wip':
      return e.progress?.in_progress ?? 0
    case 'open':
      return e.progress?.open ?? 0
  }
}

export function applyEpicSorts(
  items: readonly RoadmapItem[],
  criteria: readonly SortCriterion<EpicSortFieldKey>[],
): RoadmapItem[] {
  return applySortsGeneric(items, criteria, extractEpic)
}
