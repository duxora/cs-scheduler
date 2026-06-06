import type { Digest, DigestNudge, DigestRisk, FocusItem, KpiDelta } from '../types'

const RISK_STYLES: Record<DigestRisk['severity'], string> = {
  high: 'border-red-800 bg-red-950/40 text-red-300',
  medium: 'border-amber-800 bg-amber-950/40 text-amber-300',
  low: 'border-gray-700 bg-gray-900 text-gray-300',
}

const NUDGE_STYLES: Record<DigestNudge['type'], string> = {
  stale_objective: 'border-amber-800/80 bg-amber-950/30 text-amber-200',
  pace: 'border-blue-800/80 bg-blue-950/30 text-blue-200',
  missing_win: 'border-emerald-800/80 bg-emerald-950/30 text-emerald-200',
}

function formatDeltaArrow(kpi: KpiDelta): string {
  if (kpi.prev_current === null || kpi.current === null) return '—'
  const current = Number.parseFloat(kpi.current)
  const previous = Number.parseFloat(kpi.prev_current)
  if (Number.isNaN(current) || Number.isNaN(previous)) return '—'
  if (current > previous) return '▲'
  if (current < previous) return '▼'
  return '—'
}

function formatMetricLine(kpi: KpiDelta): string {
  const current = kpi.current ?? '—'
  const previous = kpi.prev_current ?? '—'
  const unit = kpi.unit ? ` ${kpi.unit}` : ''
  return `${current}${unit} vs ${previous}${unit}`
}

function sortRisks(risks: DigestRisk[]): DigestRisk[] {
  const order: Record<DigestRisk['severity'], number> = { high: 0, medium: 1, low: 2 }
  return [...risks].sort((left, right) => order[left.severity] - order[right.severity])
}

interface DigestPanelsProps {
  digest: Digest
  isReadOnly: boolean
  isSavingFocus: boolean
  onFocusToggle: (index: number, checked: boolean) => Promise<void> | void
  onNudgeClick: (nudge: DigestNudge) => void
}

export default function DigestPanels({
  digest,
  isReadOnly,
  isSavingFocus,
  onFocusToggle,
  onNudgeClick,
}: DigestPanelsProps) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-gray-100">KPI delta strip</h2>
            <p className="text-xs text-gray-500">Week-over-week objective signals.</p>
          </div>
        </div>

        {digest.kpi_deltas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
            No objective deltas captured for this week.
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {digest.kpi_deltas.map((kpi) => (
              <article key={kpi.objective_id} className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-gray-100">{kpi.objective_name}</h3>
                    <p className="text-xs text-gray-500">{kpi.project_name}</p>
                  </div>
                  <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300">
                    {formatDeltaArrow(kpi)}
                  </span>
                </div>
                <p className="text-sm text-gray-200">{formatMetricLine(kpi)}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {kpi.metric ?? 'metric'}
                  {kpi.target !== null ? ` · target ${kpi.target}${kpi.unit ? ` ${kpi.unit}` : ''}` : ''}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-4">
            <h2 className="text-sm font-medium text-gray-100">Proposed focus</h2>
            <p className="text-xs text-gray-500">Review and accept the focus items you want to carry forward.</p>
          </div>

          {digest.focus.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
              No focus items proposed yet.
            </div>
          ) : (
            <div className="space-y-3">
              {digest.focus.map((item: FocusItem, index: number) => (
                <label
                  key={`${item.text}-${index}`}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
                    item.accepted
                      ? 'border-emerald-800/70 bg-emerald-950/20'
                      : 'border-gray-800 bg-gray-950/70'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.accepted}
                    disabled={isReadOnly || isSavingFocus}
                    onChange={(event) => void onFocusToggle(index, event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-gray-700 bg-gray-950 text-emerald-400 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200">{item.text}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {item.accepted ? 'Accepted' : isReadOnly ? 'Read-only' : 'Mark accepted to carry it forward'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </section>

        <aside className="grid gap-4 self-start">
          <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="mb-4">
              <h2 className="text-sm font-medium text-gray-100">Risks</h2>
              <p className="text-xs text-gray-500">Severity-ranked with evidence count.</p>
            </div>

            {digest.risks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
                No risks surfaced in this draft.
              </div>
            ) : (
              <div className="space-y-3">
                {sortRisks(digest.risks).map((risk, index) => (
                  <article key={`${risk.title}-${index}`} className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${RISK_STYLES[risk.severity]}`}>
                        {risk.severity}
                      </span>
                      <span className="rounded-full border border-gray-700 bg-gray-900 px-2.5 py-1 text-[11px] text-gray-300">
                        {risk.evidence_count} evidence
                      </span>
                    </div>
                    <p className="text-sm text-gray-200">{risk.title}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="mb-4">
              <h2 className="text-sm font-medium text-gray-100">Nudges</h2>
              <p className="text-xs text-gray-500">Interactive reminders tied back to projects when available.</p>
            </div>

            {digest.nudges.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
                No nudges proposed in this draft.
              </div>
            ) : (
              <div className="space-y-3">
                {digest.nudges.map((nudge, index) => {
                  const clickable = nudge.project_id !== null
                  return (
                    <button
                      key={`${nudge.message}-${index}`}
                      type="button"
                      onClick={() => onNudgeClick(nudge)}
                      disabled={!clickable}
                      className={`w-full rounded-xl border border-gray-800 bg-gray-950/70 p-3 text-left ${
                        clickable ? 'transition-colors hover:border-gray-700' : 'cursor-default'
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${NUDGE_STYLES[nudge.type]}`}>
                          {nudge.type}
                        </span>
                        {clickable ? (
                          <span className="text-[11px] text-gray-500">Open project</span>
                        ) : null}
                      </div>
                      <p className="text-sm text-gray-200">{nudge.message}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
