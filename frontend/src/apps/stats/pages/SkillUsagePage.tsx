import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../../../shared/fetcher'

type OwnedKind = 'skill' | 'command'
type ViewMode = 'skills' | 'commands' | 'mcp'

interface SkillSummaryData {
  skills_on_disk: number
  skills_used: number
  skills_unused: number
  total_invocations: number
  history_since: string | null
  history_days: number
}

interface UsageEntry {
  name: string
  kind: OwnedKind | null
  total: number
  count_7d: number
  count_30d: number
  last_used: string | null
}

interface RetireCandidate {
  name: string
  kind: OwnedKind
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
  summary: SkillSummaryData
  top: UsageEntry[]
  retire_candidates: RetireCandidate[]
  unmatched: UnmatchedEntry[]
}

interface MpcTopToolEntry {
  tool: string
  total: number
}

interface McpServerEntry {
  name: string
  total: number
  count_30d: number
  last_used: string
  top_tools: MpcTopToolEntry[]
}

interface McpRetireCandidate {
  name: string
  reason: string
}

interface McpActiveElsewhereEntry {
  name: string
  total: number
}

interface McpSummaryData {
  servers_configured: number
  servers_used: number
  servers_unused: number
  total_invocations: number
  distinct_tools: number
  history_since: string | null
  history_days: number
  inventory_captured_at: string | null
}

interface McpUsageData {
  summary: McpSummaryData
  top_servers: McpServerEntry[]
  retire_candidates: McpRetireCandidate[]
  active_elsewhere: McpActiveElsewhereEntry[]
}

interface FilteredSkillView {
  summary: SkillSummaryData
  top: UsageEntry[]
  retire_candidates: RetireCandidate[]
  unmatched: UnmatchedEntry[]
}

interface StatCardProps {
  label: string
  value: string | number | undefined
  valueClass?: string
  className?: string
}

function SkeletonBox() {
  return <div className="h-8 w-16 rounded bg-gray-700 motion-safe:animate-pulse" />
}

function StatCard({ label, value, valueClass, className }: StatCardProps) {
  return (
    <div className={`rounded-lg border border-gray-700 bg-gray-800/50 p-4 ${className ?? ''}`}>
      <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${valueClass ?? ''}`}>
        {value === undefined ? <SkeletonBox /> : value}
      </div>
    </div>
  )
}

function formatLastUsed(value: string | null): string {
  return value ?? '—'
}

function formatKind(kind: OwnedKind | null): string {
  if (kind === null) return 'external'
  return kind
}

function sumTotals(entries: UsageEntry[]): number {
  return entries.reduce((total, entry) => total + entry.total, 0)
}

function buildFilteredSkillView(data: SkillUsageData, kind: OwnedKind): FilteredSkillView {
  const top = data.top.filter((entry) => entry.kind === kind)
  const retireCandidates = data.retire_candidates.filter((entry) => entry.kind === kind)
  const usedOwnedNames = new Set<string>(top.map((entry) => entry.name))

  const skillsOnDisk = usedOwnedNames.size + retireCandidates.length
  const skillsUsed = usedOwnedNames.size

  return {
    summary: {
      skills_on_disk: skillsOnDisk,
      skills_used: skillsUsed,
      skills_unused: retireCandidates.length,
      total_invocations: sumTotals(top),
      history_since: data.summary.history_since,
      history_days: data.summary.history_days,
    },
    top,
    retire_candidates: retireCandidates,
    unmatched: data.unmatched,
  }
}

const SKILL_USAGE_URL = '/api/stats/skill-usage'
const MCP_USAGE_URL = '/api/stats/mcp-usage'

export default function SkillUsagePage() {
  const [activeMode, setActiveMode] = useState<ViewMode>('skills')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({})

  const { data: skillData, error: skillError, mutate: mutateSkill } = useSWR<SkillUsageData>(
    SKILL_USAGE_URL,
    fetcher,
    { refreshInterval: 60_000 },
  )

  const { data: mcpData, error: mcpError, mutate: mutateMcp } = useSWR<McpUsageData>(
    MCP_USAGE_URL,
    fetcher,
    { refreshInterval: 60_000 },
  )

  const filteredSkills = useMemo(
    () => (skillData ? buildFilteredSkillView(skillData, 'skill') : null),
    [skillData],
  )
  const filteredCommands = useMemo(
    () => (skillData ? buildFilteredSkillView(skillData, 'command') : null),
    [skillData],
  )

  const activeSkillView = activeMode === 'skills' ? filteredSkills : filteredCommands
  const activeError = activeMode === 'mcp' ? mcpError : skillError

  async function handleRefresh() {
    setIsRefreshing(true)
    setRefreshError(null)
    try {
      const endpoint = activeMode === 'mcp'
        ? '/api/stats/mcp-usage/refresh'
        : '/api/stats/skill-usage/refresh'
      const response = await fetch(endpoint, { method: 'POST' })
      if (!response.ok) {
        throw new Error(`Refresh failed with status ${response.status}`)
      }
      if (activeMode === 'mcp') {
        await mutateMcp()
      } else {
        await mutateSkill()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed'
      setRefreshError(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  function toggleServer(name: string) {
    setExpandedServers((current) => ({ ...current, [name]: !current[name] }))
  }

  return (
    <div className="flex min-h-full flex-col overflow-y-auto bg-gray-950 p-4 text-gray-100">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold">Skill Usage</h1>
          <p className="text-sm text-gray-500">Skill, command, and MCP usage across available Claude history</p>
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

      <div className="mb-6 inline-flex w-fit rounded-lg border border-gray-700 bg-gray-900 p-1">
        {([
          ['skills', 'Skills'],
          ['commands', 'Commands'],
          ['mcp', 'MCP'],
        ] as const).map(([mode, label]) => {
          const isActive = activeMode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setActiveMode(mode)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-800 text-blue-400'
                  : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {(activeError || refreshError) && (
        <div className="mb-4 rounded border border-red-700 bg-red-900/20 px-3 py-2 text-sm text-red-400" role="alert">
          {refreshError ?? 'Usage stats failed to load — server may be unavailable.'}
        </div>
      )}

      {activeMode === 'mcp' ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-7">
            <StatCard label="Configured" value={mcpData?.summary.servers_configured} />
            <StatCard label="Used" value={mcpData?.summary.servers_used} valueClass="text-green-400" />
            <StatCard label="Unused" value={mcpData?.summary.servers_unused} valueClass="text-amber-400" />
            <StatCard label="Invocations" value={mcpData?.summary.total_invocations} />
            <StatCard label="Distinct Tools" value={mcpData?.summary.distinct_tools} />
            <StatCard label="History Since" value={mcpData?.summary.history_since ?? undefined} />
            <StatCard label="Inventory Captured" value={mcpData?.summary.inventory_captured_at ?? undefined} />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-gray-700 bg-gray-800/50">
              <div className="border-b border-gray-700 px-4 py-3">
                <h2 className="text-lg font-semibold">Top Servers</h2>
                <p className="mt-1 text-xs text-gray-500">Expand a server row to inspect its most-used tools</p>
              </div>
              <div className="overflow-x-auto">
                {!mcpData || mcpData.top_servers.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No MCP usage yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Server</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Total</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">30d</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Last Used</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Tools</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mcpData.top_servers.map((entry) => {
                        const isExpanded = Boolean(expandedServers[entry.name])
                        return (
                          <tr key={entry.name} className="border-b border-gray-800 last:border-0">
                            <td className="px-4 py-2">
                              <span className="font-mono text-xs text-blue-400">{entry.name}</span>
                            </td>
                            <td className="px-4 py-2 text-gray-300">{entry.total}</td>
                            <td className="px-4 py-2 text-gray-400">{entry.count_30d}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-gray-500">{entry.last_used}</td>
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => toggleServer(entry.name)}
                                className="text-xs text-blue-400 hover:text-blue-300"
                              >
                                {isExpanded ? 'Hide tools' : `Show tools (${entry.top_tools.length})`}
                              </button>
                              {isExpanded && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {entry.top_tools.map((toolEntry) => (
                                    <span
                                      key={`${entry.name}-${toolEntry.tool}`}
                                      className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300"
                                    >
                                      <span className="font-mono">{toolEntry.tool}</span>
                                      <span className="text-gray-500">{toolEntry.total}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <div className="flex flex-col gap-6">
              <section className="rounded-lg border border-gray-700 bg-gray-800/50">
                <div className="border-b border-gray-700 px-4 py-3">
                  <h2 className="text-lg font-semibold">Retire Candidates</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    Unused in the available {mcpData?.summary.history_days ?? '—'}d window
                  </p>
                </div>
                <div className="p-4">
                  {!mcpData || mcpData.retire_candidates.length === 0 ? (
                    <p className="text-sm text-gray-500">No unused configured MCP servers detected.</p>
                  ) : (
                    <ul className="space-y-3">
                      {mcpData.retire_candidates.map((entry) => (
                        <li key={entry.name} className="rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                          <div className="font-mono text-sm text-gray-100">{entry.name}</div>
                          <p className="mt-2 text-xs text-gray-500">{entry.reason}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-gray-700 bg-gray-800/50">
                <div className="border-b border-gray-700 px-4 py-3">
                  <h2 className="text-lg font-semibold">Active-in-other-contexts</h2>
                  <p className="mt-1 text-xs text-gray-500">Used in history but not matched to the current configured inventory</p>
                </div>
                <div className="p-4">
                  {!mcpData || mcpData.active_elsewhere.length === 0 ? (
                    <p className="text-sm text-gray-500">No external-context activity detected.</p>
                  ) : (
                    <ul className="space-y-3">
                      {mcpData.active_elsewhere.map((entry) => (
                        <li key={entry.name} className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900/60 p-3">
                          <span className="font-mono text-sm text-blue-400">{entry.name}</span>
                          <span className="text-xs text-gray-400">{entry.total}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={activeMode === 'skills' ? 'Skills On Disk' : 'Commands On Disk'} value={activeSkillView?.summary.skills_on_disk} />
            <StatCard label="Used" value={activeSkillView?.summary.skills_used} valueClass="text-green-400" />
            <StatCard label="Unused" value={activeSkillView?.summary.skills_unused} valueClass="text-amber-400" />
            <StatCard label="Total Invocations" value={activeSkillView?.summary.total_invocations} />
            <StatCard label="History Since" value={activeSkillView?.summary.history_since ?? undefined} className="col-span-2 lg:col-span-1" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-gray-700 bg-gray-800/50">
              <div className="border-b border-gray-700 px-4 py-3">
                <h2 className="text-lg font-semibold">Most Used</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Frequent usage across matched {activeMode === 'skills' ? 'skills' : 'commands'}
                </p>
              </div>
              <div className="overflow-x-auto">
                {!activeSkillView || activeSkillView.top.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No matched usage yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">#</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Total</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">30d</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">7d</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Last Used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeSkillView.top.map((entry, index) => (
                        <tr key={entry.name} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/30">
                          <td className="px-4 py-2 text-xs text-gray-500">{index + 1}</td>
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
                          <td className="px-4 py-2 whitespace-nowrap text-gray-500">{formatLastUsed(entry.last_used)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <div className="flex flex-col gap-6">
              <section className="rounded-lg border border-gray-700 bg-gray-800/50">
                <div className="border-b border-gray-700 px-4 py-3">
                  <h2 className="text-lg font-semibold">Retire Candidates</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    Unused in the available {activeSkillView?.summary.history_days ?? '—'}d window
                  </p>
                </div>
                <div className="p-4">
                  {!activeSkillView || activeSkillView.retire_candidates.length === 0 ? (
                    <p className="text-sm text-gray-500">No unused owned entries detected.</p>
                  ) : (
                    <ul className="space-y-3">
                      {activeSkillView.retire_candidates.map((entry) => (
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
                          <p className="mt-2 text-xs text-gray-500">Sources: {entry.sources.join(', ')}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

            </div>
          </div>

          <section className="mt-6 rounded-lg border border-gray-700 bg-gray-800/50">
            <button
              type="button"
              onClick={() => setShowUnmatched((value) => !value)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div>
                <h2 className="text-lg font-semibold">Non-skill invocations ({activeSkillView?.unmatched.length ?? 0})</h2>
                <p className="mt-1 text-xs text-gray-500">Tool and agent calls kept visible instead of silently dropped</p>
              </div>
              <span className="text-sm text-blue-400">{showUnmatched ? 'Hide' : 'Show'}</span>
            </button>
            {showUnmatched && (
              <div className="border-t border-gray-700 px-4 py-3">
                {!activeSkillView || activeSkillView.unmatched.length === 0 ? (
                  <p className="text-sm text-gray-500">No unmatched invocations.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeSkillView.unmatched.map((entry) => (
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
        </>
      )}
    </div>
  )
}
