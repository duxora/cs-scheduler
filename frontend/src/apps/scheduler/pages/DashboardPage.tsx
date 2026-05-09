import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSchedulerTasks } from '../hooks/useSchedulerTasks'
import { useSchedulerStats } from '../hooks/useSchedulerStats'
import { schedulerApi } from '../lib/api'

function statusColor(status?: string | null): string {
  if (!status) return 'text-gray-500 bg-gray-900 border-gray-700'
  if (status === 'success') return 'text-green-400 bg-green-950 border-green-800'
  if (status === 'failed' || status === 'timeout') return 'text-red-400 bg-red-950 border-red-800'
  if (status === 'running' || status === 'pending') return 'text-yellow-400 bg-yellow-950 border-yellow-800'
  return 'text-gray-400 bg-gray-900 border-gray-700'
}

function formatDate(ts?: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

function accountChip(account?: string | null) {
  if (!account) {
    return <span className="text-[10px] text-gray-500">(default)</span>
  }
  return (
    <span className="inline-flex items-center rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-300">
      {account}
    </span>
  )
}

export default function DashboardPage() {
  const { tasks, error: tasksError, isLoading, mutate } = useSchedulerTasks()
  const { stats } = useSchedulerStats()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<Set<string>>(new Set())

  async function handleToggle(slug: string) {
    setBusy((prev) => new Set(prev).add(`toggle-${slug}`))
    try {
      await schedulerApi.toggleTask(slug)
      await mutate()
    } finally {
      setBusy((prev) => { const s = new Set(prev); s.delete(`toggle-${slug}`); return s })
    }
  }

  async function handleRun(slug: string) {
    setBusy((prev) => new Set(prev).add(`run-${slug}`))
    try {
      await schedulerApi.runTask(slug)
      await mutate()
    } finally {
      setBusy((prev) => { const s = new Set(prev); s.delete(`run-${slug}`); return s })
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-y-auto">
      {/* Stats row */}
      {stats && (
        <div className="flex gap-3 px-4 py-3 border-b border-gray-800 shrink-0 flex-wrap">
          {[
            { label: 'Total', value: stats.total_tasks },
            { label: 'Enabled', value: stats.enabled, color: 'text-green-400' },
            { label: 'Disabled', value: stats.disabled, color: 'text-gray-500' },
            { label: 'Runs', value: stats.total_runs },
            { label: 'Failures', value: stats.failures, color: stats.failures > 0 ? 'text-red-400' : undefined },
            { label: 'Cost', value: `$${stats.total_cost.toFixed(4)}`, color: 'text-yellow-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col items-center px-3 py-1.5 bg-gray-900 rounded border border-gray-800 min-w-[60px]">
              <span className={`text-sm font-semibold ${color ?? 'text-white'}`}>{value}</span>
              <span className="text-[10px] text-gray-500 mt-0.5">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500">
          {isLoading ? 'Loading...' : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
        </span>
        {tasksError && (
          <span className="text-[10px] text-red-400 bg-red-950 px-1.5 py-0.5 rounded border border-red-800">API error</span>
        )}
        <button
          onClick={() => navigate('/scheduler/tasks/new')}
          className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2.5 py-1 rounded transition-colors"
        >
          + New Task
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-gray-600">Loading tasks...</span>
          </div>
        )}
        {!isLoading && tasks.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-gray-600">No tasks found</span>
          </div>
        )}
        {!isLoading && tasks.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1.5 pr-4 font-medium">Name</th>
                <th className="text-left py-1.5 pr-4 font-medium">Account</th>
                <th className="text-left py-1.5 pr-4 font-medium">Schedule</th>
                <th className="text-left py-1.5 pr-4 font-medium">Status</th>
                <th className="text-left py-1.5 pr-4 font-medium">Last Run</th>
                <th className="text-left py-1.5 pr-4 font-medium">Enabled</th>
                <th className="text-left py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.slug} className="border-b border-gray-900 hover:bg-gray-900/40">
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => navigate(`/scheduler/tasks/${task.slug}`)}
                      className="text-blue-400 hover:text-blue-300 hover:underline text-left"
                    >
                      {task.name}
                    </button>
                  </td>
                  <td className="py-2 pr-4">
                    {accountChip(task.account)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-400">{task.schedule}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusColor(task.last_status)}`}>
                      {task.last_status ?? 'unknown'}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-400">{formatDate(task.last_run_at)}</td>
                  <td className="py-2 pr-4">
                    <button
                      onClick={() => handleToggle(task.slug)}
                      disabled={busy.has(`toggle-${task.slug}`)}
                      aria-label={`${task.enabled ? 'Disable' : 'Enable'} ${task.name}`}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${task.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${task.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => handleRun(task.slug)}
                      disabled={busy.has(`run-${task.slug}`)}
                      className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-0.5 rounded border border-gray-700 transition-colors disabled:opacity-50"
                    >
                      {busy.has(`run-${task.slug}`) ? 'Running...' : 'Run'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
