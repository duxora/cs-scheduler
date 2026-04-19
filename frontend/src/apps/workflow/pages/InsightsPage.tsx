import { useInsights } from '../hooks/useInsights'
import { useUrlParam } from '../hooks/useUrlParam'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import FlowEfficiencyCards from '../components/FlowEfficiencyCards'
import InsightsStrip from '../components/InsightsStrip'
import InsightAlerts from '../components/InsightAlerts'
import FilterBar from '../components/common/FilterBar'

const PIPELINE_OPTIONS = [
  { value: '', label: 'All pipelines' },
  { value: 'code', label: 'Code' },
  { value: 'research', label: 'Research' },
  { value: 'docs', label: 'Docs' },
  { value: 'solo-commit', label: 'Solo commit' },
]

const SIZE_OPTIONS = [
  { value: '', label: 'All sizes' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

const PERIOD_OPTIONS = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
]

export default function InsightsPage() {
  const [pipeline, setPipeline] = useUrlParam('pipeline')
  const [size, setSize] = useUrlParam('size')
  const [period, setPeriod] = useUrlParam('period', '30d')

  const { data, isLoading, error } = useInsights({
    pipeline: pipeline || undefined,
    size: size || undefined,
    period,
  })

  return (
    <div className="h-full overflow-y-auto bg-gray-950 p-4 flex flex-col gap-4">
      {/* Filter bar */}
      <FilterBar className="px-0 border-none py-0">
        <FilterBar.Select
          value={pipeline}
          onChange={(e) => setPipeline(e.target.value)}
          selectClassName="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-gray-600"
        >
          {PIPELINE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </FilterBar.Select>

        <FilterBar.Select
          value={size}
          onChange={(e) => setSize(e.target.value)}
          selectClassName="bg-gray-900 border border-gray-800 text-gray-300 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-gray-600"
        >
          {SIZE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </FilterBar.Select>

        <SegmentedControl
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
          containerClassName="ml-auto"
        />
      </FilterBar>

      {/* Loading / error states */}
      {isLoading && (
        <div className="text-xs text-gray-500">Loading insights…</div>
      )}
      {error && (
        <div className="text-xs text-red-400">Failed to load insights: {String(error)}</div>
      )}

      {/* Empty state */}
      {data && data.total_runs === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 text-center max-w-xs">
            No pipeline runs recorded yet. Data starts collecting after your next tkt_done.
          </p>
        </div>
      )}

      {/* Content */}
      {data && data.total_runs > 0 && (
        <>
          {/* Alerts */}
          {data.alerts.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Alerts</h2>
              <InsightAlerts alerts={data.alerts} />
            </section>
          )}

          {/* Flow Efficiency */}
          {data.flow_efficiency.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Flow Efficiency</h2>
                <span className="text-xs text-gray-600">{data.total_runs} total runs · {data.period}</span>
              </div>
              <FlowEfficiencyCards items={data.flow_efficiency} />
            </section>
          )}

          {/* Step Breakdown */}
          {data.steps.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Step Breakdown</h2>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <InsightsStrip steps={data.steps} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
