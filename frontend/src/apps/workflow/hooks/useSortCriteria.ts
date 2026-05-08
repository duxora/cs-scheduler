/**
 * useSortCriteria — manages multi-criteria sort state with URL persistence.
 *
 * Generic over field-key type `F` so it can drive task, project, and epic
 * list sort independently (each with its own field set, storage key, and
 * URL param).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  parseSort,
  serializeSort,
  type SortCriterion,
} from '../lib/sort'
import type { SortDirection, SortFieldDef } from '../lib/tokens'

export interface SortCriteriaConfig<F extends string> {
  /** All valid fields for this entity. Used for parsing + cycleHeader defaults. */
  fields: readonly SortFieldDef<F>[]
  /** Default sort applied when user has not configured anything. */
  defaultSort: readonly SortCriterion<F>[]
  /** Per-entity storage key for localStorage. */
  storageKey: string
  /** Per-entity URL query parameter name. */
  urlParam: string
}

function readInitial<F extends string>(config: SortCriteriaConfig<F>): SortCriterion<F>[] {
  if (typeof window === 'undefined') return config.defaultSort.slice()

  const validSet = new Set<F>(config.fields.map((f) => f.key))
  const fromUrl = parseSort<F>(
    new URLSearchParams(window.location.search).get(config.urlParam),
    validSet,
  )
  if (fromUrl.length > 0) return fromUrl

  try {
    const stored = window.localStorage.getItem(config.storageKey)
    const parsed = parseSort<F>(stored, validSet)
    if (parsed.length > 0) return parsed
  } catch {
    // localStorage may throw in private browsing — ignore and fall through.
  }

  return config.defaultSort.slice()
}

function writeBack<F extends string>(
  criteria: readonly SortCriterion<F>[],
  config: SortCriteriaConfig<F>,
): void {
  if (typeof window === 'undefined') return

  const serialized = serializeSort(criteria)
  const url = new URL(window.location.href)
  if (serialized) {
    url.searchParams.set(config.urlParam, serialized)
  } else {
    url.searchParams.delete(config.urlParam)
  }
  window.history.replaceState(null, '', url.toString())

  try {
    window.localStorage.setItem(config.storageKey, serialized)
  } catch {
    // ignore
  }
}

export interface UseSortCriteriaReturn<F extends string> {
  criteria: SortCriterion<F>[]
  /** Append a field, or move it to the end if already present. */
  add: (field: F, dir?: SortDirection) => void
  /** Remove a field by key. No-op if absent. */
  remove: (field: F) => void
  /** Flip the direction of a single criterion. */
  toggleDir: (field: F) => void
  /** Reorder via dragging — moves `field` to the position of `targetField`. */
  reorder: (field: F, targetField: F) => void
  /**
   * Header-click cycle: none → asc → desc → removed.
   * If `append` is true, mutates in-place; otherwise replaces the whole list.
   */
  cycleHeader: (field: F, append: boolean) => void
  /** Reset to default sort. */
  reset: () => void
  /** True if current criteria differ from the configured default. */
  isModified: boolean
}

function criteriaEqual<F extends string>(
  a: readonly SortCriterion<F>[],
  b: readonly SortCriterion<F>[],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.field !== b[i]!.field) return false
    if (a[i]!.dir !== b[i]!.dir) return false
  }
  return true
}

export function useSortCriteria<F extends string>(
  config: SortCriteriaConfig<F>,
): UseSortCriteriaReturn<F> {
  const [criteria, setCriteria] = useState<SortCriterion<F>[]>(() => readInitial(config))

  // Persist to URL + localStorage on every change.
  useEffect(() => { writeBack(criteria, config) }, [criteria, config])

  const fieldMap = config.fields.reduce(
    (acc, f) => { acc[f.key] = f; return acc },
    {} as Record<F, SortFieldDef<F>>,
  )

  const add = useCallback((field: F, dir?: SortDirection) => {
    setCriteria((prev) => {
      const next = prev.filter((c) => c.field !== field)
      next.push({ field, dir: dir ?? fieldMap[field]!.defaultDir })
      return next
    })
  }, [fieldMap])

  const remove = useCallback((field: F) => {
    setCriteria((prev) => prev.filter((c) => c.field !== field))
  }, [])

  const toggleDir = useCallback((field: F) => {
    setCriteria((prev) =>
      prev.map((c) => (c.field === field ? { ...c, dir: c.dir === 'asc' ? 'desc' : 'asc' } : c)),
    )
  }, [])

  const reorder = useCallback((field: F, targetField: F) => {
    if (field === targetField) return
    setCriteria((prev) => {
      const fromIdx = prev.findIndex((c) => c.field === field)
      const toIdx   = prev.findIndex((c) => c.field === targetField)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      if (!moved) return prev
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  const cycleHeader = useCallback((field: F, append: boolean) => {
    setCriteria((prev) => {
      const existing = prev.find((c) => c.field === field)
      const base = append ? prev.filter((c) => c.field !== field) : []

      if (!existing) {
        return [...base, { field, dir: fieldMap[field]!.defaultDir }]
      }
      if (existing.dir === 'asc') {
        return [...base, { field, dir: 'desc' }]
      }
      return base
    })
  }, [fieldMap])

  const reset = useCallback(() => setCriteria(config.defaultSort.slice()), [config.defaultSort])

  const isModified = !criteriaEqual(criteria, config.defaultSort)

  return { criteria, add, remove, toggleDir, reorder, cycleHeader, reset, isModified }
}
