import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { fetcher } from '../../../shared/fetcher'

interface OverviewData {
  local_kb: { total_entries: number; by_domain: Record<string, number>; ratings: { good: number; bad: number; great: number } }
  domain_kb: { total_nodes: number; active_nodes: number; total_domains: number }
  scheduler: { runs_today: number; runs_7d: number; success_rate_7d: number; active_tasks: number }
}

interface ViewedEntry {
  id: string
  title: string
  domain: string
  view_count: number
}

interface RunRecord {
  task_name: string
  started_at: string
  completed_at: string | null
  status: string
  duration_seconds: number | null
  cost_usd: number | null
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  return `$${usd.toFixed(3)}`
}

function getStatusColor(status: string): string {
  if (status === 'success') return 'text-green-400'
  if (status === 'failed') return 'text-red-400'
  if (status === 'running') return 'text-blue-400'
  return 'text-gray-400'
}

function SkeletonBox() {
  return <div className="h-8 w-16 bg-gray-700 rounded motion-safe:animate-pulse" />
}

function StatCard({ label, value, valueClass, className }: { label: string; value: string | number | undefined; valueClass?: string; className?: string }) {
  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg p-4 ${className ?? ''}`}>
      <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${valueClass ?? ''}`}>
        {value === undefined ? <SkeletonBox /> : value}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { data: overview, error: overviewError } = useSWR<OverviewData>(
    '/api/stats/overview',
    fetcher,
    { refreshInterval: 60_000 },
  )

  const { data: viewed, error: viewedError } = useSWR<ViewedEntry[]>(
    '/api/stats/views?period=7',
    fetcher,
    { refreshInterval: 60_000 },
  )

  const { data: runs, error: runsError } = useSWR<RunRecord[]>(
    '/api/stats/runs?limit=20',
    fetcher,
    { refreshInterval: 30_000 },
  )

  const successRate = overview ? Math.round(overview.scheduler.success_rate_7d * 100 * 10) / 10 : 0

  return (
    <div className="flex flex-col min-h-full bg-gray-950 text-gray-100 p-4 overflow-y-auto">
      {/* Header */}
      <h1 className="text-2xl font-bold mb-1">Stats</h1>
      <p className="text-sm text-gray-500 mb-6">Knowledge base and automation analytics</p>

      {/* Error banner */}
      {(overviewError || viewedError || runsError) && (
        <div className="mb-4 px-3 py-2 rounded border border-red-700 bg-red-900/20 text-red-400 text-sm" role="alert">
          Some stats failed to load — server may be unavailable.
        </div>
      )}

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="KB Entries" value={overview?.local_kb.total_entries} />
        <StatCard label="Good Ratings" value={overview ? (overview.local_kb.ratings.good + overview.local_kb.ratings.great) : undefined} />
        <StatCard label="KG Nodes" value={overview?.domain_kb.total_nodes} />
        <StatCard
          label="Runs Today"
          value={overview?.scheduler.runs_today}
        />
        <StatCard
          label="7d Success"
          value={overview ? `${successRate}%` : undefined}
          valueClass={
            overview === undefined ? '' :
            successRate >= 90 ? 'text-green-400' :
            successRate >= 70 ? 'text-amber-400' :
            'text-red-400'
          }
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Viewed (7d) */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-700">
            <h2 className="text-lg font-semibold">Most Viewed (7d)</h2>
          </div>
          <div className="p-4">
            {!viewed || viewed.length === 0 ? (
              <p className="text-gray-500 text-sm">No views yet.</p>
            ) : (
              <ol>
                {viewed.map((entry, idx) => (
                  <li
                    key={entry.id}
                    className="py-3 border-b border-gray-800 last:border-0 flex items-center gap-3 hover:bg-gray-800/20 transition-colors duration-150 -mx-4 px-4 rounded"
                  >
                    <span className="text-xs text-gray-600 w-5 shrink-0">{idx + 1}</span>
                    <Link
                      to={`/kb/entry/${entry.id}`}
                      className="text-sm text-gray-200 flex-1 min-w-0 truncate hover:text-blue-400 transition-colors duration-150"
                    >
                      {entry.title}
                    </Link>
                    <span className="text-xs px-1.5 py-0.5 rounded border border-gray-600 text-gray-400 shrink-0">
                      {entry.domain}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0">{entry.view_count}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {/* Recent Runs */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-700">
            <h2 className="text-lg font-semibold">Recent Runs</h2>
          </div>
          <div className="overflow-x-auto">
            {!runs || runs.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No runs yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Task</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Status</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Duration</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Cost</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={`${run.task_name}-${run.started_at}`} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/30 transition-colors duration-150">
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-blue-400">{run.task_name}</span>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${getStatusColor(run.status)}`}>
                          {run.status === 'running' && (
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 motion-safe:animate-pulse shrink-0" />
                          )}
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs">
                        {formatDuration(run.duration_seconds)}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs">
                        {formatCost(run.cost_usd)}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                        {run.started_at?.slice(0, 16) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
