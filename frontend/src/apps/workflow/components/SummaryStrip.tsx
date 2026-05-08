import type { ReviewSummary } from '../types'
import { formatDuration } from '../lib/time'

function formatTokens(tokens: number): string {
  if (tokens <= 0) return '~0k'
  return `~${Math.max(1, Math.round(tokens / 1000))}k`
}

export default function SummaryStrip({ summary }: { summary: ReviewSummary }) {
  return (
    <div className="bg-gray-900/50 border-b border-gray-800 px-4 py-2.5">
      <div className="grid grid-cols-4 divide-x divide-gray-800">
        <Stat label="Completed" value={summary.completed.toString()} color="#34d399" />
        <Stat label="Stalled" value={summary.stalled.toString()} color="#f59e0b" />
        <Stat label="Tokens" value={formatTokens(summary.tokens_today)} color="#818cf8" />
        <Stat
          label="Avg duration"
          value={summary.avg_duration_s > 0 ? formatDuration(summary.avg_duration_s) : '—'}
          color="#ffffff"
        />
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="px-3 first:pl-0 last:pr-0">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  )
}
