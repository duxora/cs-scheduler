import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))

function PageLoader() {
  return <div className="flex items-center justify-center h-32 text-gray-500 text-sm">Loading…</div>
}

export default function SplannerApp() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
