import useSWR from 'swr'
import type { TreeResponse } from '../types'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  if (!r.ok) throw new Error(`${r.status}`)
  return r.json()
})

/**
 * Fetches `/workflow/api/tree/:id` only once `enabled` flips true - i.e. the
 * first time a drawer section that needs it is opened, not on every drawer
 * open and not per-row. One call serves any number of consumers that share
 * the same `id` + `enabled` gate (both the inline tree and inline task-list
 * sections read the same subtree).
 */
export function useLazySubtree(id: number, enabled: boolean) {
  const { data, error, isLoading } = useSWR<TreeResponse>(
    enabled ? `/workflow/api/tree/${id}` : null,
    fetcher,
  )
  return { data, error, isLoading: enabled && isLoading }
}
