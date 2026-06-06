import { lazy, Suspense } from 'react'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))

function PageLoader() {
  return <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
}

export default function SplannerApp() {
  return (
    <div className="flex flex-col h-full">
      <Suspense fallback={<PageLoader />}>
        <DashboardPage />
      </Suspense>
    </div>
  )
}
