import type { ObjectiveStatus, Project, ProjectHealth } from '../types'

const OBJECTIVE_STATUS_STYLES: Record<ObjectiveStatus, string> = {
  on_track: 'bg-emerald-400',
  at_risk: 'bg-amber-400',
  blocked: 'bg-red-400',
  done: 'bg-gray-500',
}

function getTotalObjectives(health: ProjectHealth): number {
  return health.on_track + health.at_risk + health.blocked + health.done
}

function getStripeColor(project: Project): string {
  const total = getTotalObjectives(project.health)
  if (project.is_blocked || project.health.blocked > 0 || project.items_blocked > 0) {
    return 'bg-red-400'
  }
  if (project.health.at_risk > 0) return 'bg-amber-400'
  if (total === 0 || project.health.done === total) return 'bg-gray-500'
  return 'bg-emerald-400'
}

function buildObjectiveStatuses(health: ProjectHealth): ObjectiveStatus[] {
  return [
    ...Array.from({ length: health.blocked }, () => 'blocked' as const),
    ...Array.from({ length: health.at_risk }, () => 'at_risk' as const),
    ...Array.from({ length: health.on_track }, () => 'on_track' as const),
    ...Array.from({ length: health.done }, () => 'done' as const),
  ]
}

export function HealthStripe({ project }: { project: Project }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-y-0 left-0 w-1 rounded-l-xl ${getStripeColor(project)}`}
    />
  )
}

export function StackedHealthBar({ health }: { health: ProjectHealth }) {
  const total = getTotalObjectives(health)

  if (total === 0) {
    return (
      <div className="h-2 overflow-hidden rounded-full bg-gray-800">
        <div className="h-full w-full bg-gray-600" />
      </div>
    )
  }

  const segments: Array<{ key: ObjectiveStatus; value: number }> = [
    { key: 'on_track', value: health.on_track },
    { key: 'at_risk', value: health.at_risk },
    { key: 'blocked', value: health.blocked },
    { key: 'done', value: health.done },
  ]

  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-gray-800">
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <div
            key={segment.key}
            className={OBJECTIVE_STATUS_STYLES[segment.key]}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.key.replace('_', ' ')}: ${segment.value}`}
          />
        ))}
    </div>
  )
}

export function ObjectiveDots({ health }: { health: ProjectHealth }) {
  const statuses = buildObjectiveStatuses(health)
  const visibleStatuses = statuses.slice(0, 12)
  const overflow = statuses.length - visibleStatuses.length

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visibleStatuses.length > 0 ? (
        visibleStatuses.map((status, index) => (
          <span
            key={`${status}-${index}`}
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${OBJECTIVE_STATUS_STYLES[status]}`}
            title={status.replace('_', ' ')}
          />
        ))
      ) : (
        <span className="text-xs text-gray-500">No objectives</span>
      )}
      {overflow > 0 ? <span className="text-xs text-gray-500">+{overflow}</span> : null}
    </div>
  )
}
