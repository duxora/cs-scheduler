import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../../../shared/fetcher'

interface SummaryData {
  skills_on_disk: number
  skills_used: number
  skills_unused: number
  total_invocations: number
  history_since: string | null
  history_days: number
}

interface UsageEntry {
  name: string
  kind: 'skill' | 'command' | null
  total: number
  count_7d: number
  count_30d: number
  last_used: string | null
}

interface RetireCandidate {
  name: string
  kind: 'skill' | 'command'
  sources: string[]
  last_used: string | null
  situational: boolean
  description: string
}

interface UnmatchedEntry {
  name: string
  total: number
}

interface SkillUsageData {
  summary: SummaryData
  top: UsageEntry[]
  retire_candidates: RetireCandidate[]
  enhance_candidates: UsageEntry[]
  unmatched: UnmatchedEntry[]
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

function formatKind(kind: 'skill' | 'command' | null): string {
  if (kind === null) return 'external'
  return kind
}

function formatLastUsed(value: string | null): string {
  return value ?? '—'
}

const SKILL_USAGE_URL = '/api/stats/skill-usage'

export default function SkillUsagePage() {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const { data, error, mutate } = useSWR<SkillUsageData>(
    SKILL_USAGE_URL,
    fetcher,
    { refreshInterval: 60_000 },
  )

  async function handleRefresh() {
    setIsRefreshing(true)
    setRefreshError(null)
    try {
      const response = await fetch('/api/stats/skill-usage/refresh', { method: 'POST' })
      if (!response.ok) {
        throw new Error(`Refresh failed with status ${response.status}`)
      }
      await mutate()
    } catch (refreshErr) {
      const message = refreshErr instanceof Error ? refreshErr.message : 'Refresh failed'
      setRefreshError(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full bg-gray-950 text-gray-100 p-4 overflow-y-auto">
      <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">Skill Usage</h1>
          <p className="text-sm text-gray-500">Skill and command usage across available Claude history</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {(error || refreshError) && (
        <div className="mb-4 px-3 py-2 rounded border border-red-700 bg-red-900/20 text-red-400 text-sm" role="alert">
          {refreshError ?? 'Skill usage stats failed to load — server may be unavailable.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-5">
        <StatCard label="Skills On Disk" value={data?.summary.skills_on_disk} />
        <StatCard label="Used" value={data?.summary.skills_used} valueClass="text-green-400" />
        <StatCard label="Unused" value={data?.summary.skills_unused} valueClass="text-amber-400" />
        <StatCard label="Total Invocations" value={data?.summary.total_invocations} />
        <StatCard label="History Since" value={data?.summary.history_since ?? undefined} className="col-span-2 lg:col-span-1" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="bg-gray-800/50 border border-gray-700 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-700">
            <h2 className="text-lg font-semibold">Most Used</h2>
            <p className="text-xs text-gray-500 mt-1">Frequent usage across matched skills and commands</p>
          </div>
          <div className="overflow-x-auto">
            {!data || data.top.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No matched skill usage yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">#</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Name</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Type</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Total</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">30d</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">7d</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Last Used</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((entry, idx) => (
                    <tr key={entry.name} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/30 transition-colors duration-150">
                      <td className="px-4 py-2 text-xs text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-blue-400">{entry.name}</span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex rounded border border-gray-600 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-gray-300">
                          {formatKind(entry.kind)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-300">{entry.total}</td>
                      <td className="px-4 py-2 text-gray-400">{entry.count_30d}</td>
                      <td className="px-4 py-2 text-gray-400">{entry.count_7d}</td>
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatLastUsed(entry.last_used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <section className="bg-gray-800/50 border border-gray-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-700">
              <h2 className="text-lg font-semibold">Retire Candidates</h2>
              <p className="text-xs text-gray-500 mt-1">
                Unused in the available {data?.summary.history_days ?? '—'}d window — situational/manual skills are expected to be idle.
              </p>
            </div>
            <div className="p-4">
              {!data || data.retire_candidates.length === 0 ? (
                <p className="text-sm text-gray-500">No unused owned skills detected.</p>
              ) : (
                <ul className="space-y-3">
                  {data.retire_candidates.map((entry) => (
                    <li
                      key={entry.name}
                      className={`rounded-lg border border-gray-700 bg-gray-900/60 p-3 ${entry.situational ? 'text-gray-500' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className={`font-mono text-sm ${entry.situational ? 'text-gray-500' : 'text-gray-100'}`}>{entry.name}</span>
                        <div className="flex items-center gap-2">
                          {entry.situational && (
                            <span className="inline-flex rounded border border-gray-700 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-gray-500">
                              manual/situational
                            </span>
                          )}
                          <span className="inline-flex rounded border border-gray-600 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-amber-300">
                            {entry.kind}
                          </span>
                        </div>
                      </div>
                      {entry.description && (
                        <p className="mt-2 text-xs text-gray-500">{entry.description}</p>
                      )}
                      <p className="mt-2 text-xs text-gray-500">
                        Sources: {entry.sources.join(', ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="bg-gray-800/50 border border-gray-700 rounded-lg">
            <div className="px-4 py-3 border-b border-gray-700">
              <h2 className="text-lg font-semibold">Enhance Candidates</h2>
              <p className="text-xs text-gray-500 mt-1">High-use → prioritize upgrades</p>
            </div>
            <div className="p-4">
              {!data || data.enhance_candidates.length === 0 ? (
                <p className="text-sm text-gray-500">No active owned skills to prioritize yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data.enhance_candidates.map((entry) => (
                    <li key={entry.name} className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-blue-400">{entry.name}</span>
                        <span className="inline-flex rounded border border-gray-600 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-gray-300">
                          {formatKind(entry.kind)}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-400">
                        <div>30d: {entry.count_30d}</div>
                        <div>Total: {entry.total}</div>
                        <div>Last: {formatLastUsed(entry.last_used)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="mt-6 bg-gray-800/50 border border-gray-700 rounded-lg">
        <button
          type="button"
          onClick={() => setShowUnmatched((value) => !value)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div>
            <h2 className="text-lg font-semibold">Non-skill invocations ({data?.unmatched.length ?? 0})</h2>
            <p className="text-xs text-gray-500 mt-1">Tool and agent calls kept visible instead of silently dropped</p>
          </div>
          <span className="text-sm text-blue-400">{showUnmatched ? 'Hide' : 'Show'}</span>
        </button>
        {showUnmatched && (
          <div className="border-t border-gray-700 px-4 py-3">
            {!data || data.unmatched.length === 0 ? (
              <p className="text-sm text-gray-500">No unmatched invocations.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.unmatched.map((entry) => (
                  <span
                    key={entry.name}
                    className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300"
                  >
                    <span className="font-mono">{entry.name}</span>
                    <span className="text-gray-500">{entry.total}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
