import { useEffect, useState, useCallback } from 'react'
import { fetchJson } from '../lib/api'
import type { Task } from '../types'

export function useTaskUpdates(params: { status?: string; project?: string } = {}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [lastEvent, setLastEvent] = useState<Date | null>(null)
  const [connected, setConnected] = useState(false)

  const fetchTasks = useCallback(async () => {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.project) query.set('project', params.project)
    const url = `/tasks${query.toString() ? `?${query}` : ''}`
    const data = await fetchJson<Task[]>(url)
    setTasks(data)
  }, [params.status, params.project])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTasks()

    const sse = new EventSource('/workflow/api/task-updates')

    sse.onopen = () => setConnected(true)
    sse.onmessage = () => {
      setLastEvent(new Date())
      fetchTasks()
    }
    sse.onerror = () => setConnected(false)

    return () => sse.close()
  }, [fetchTasks])

  return { tasks, connected, lastEvent }
}
