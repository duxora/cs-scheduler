import { lazy, Suspense, useState } from 'react'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SkillUsagePage = lazy(() => import('./pages/SkillUsagePage'))

type TabKey = 'dashboard' | 'skill-usage'

function PageLoader() {
  return <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
}

export default function StatsApp() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'skill-usage', label: 'Skill Usage' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="shrink-0 border-b border-gray-700 px-4 pt-4">
        <div className="inline-flex rounded-lg border border-gray-700 bg-gray-900 p-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-blue-400'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
          {activeTab === 'dashboard' ? <DashboardPage /> : <SkillUsagePage />}
        </Suspense>
      </div>
    </div>
  )
}
