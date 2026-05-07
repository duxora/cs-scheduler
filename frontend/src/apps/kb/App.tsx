import { NavLink, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const EntryDetailPage = lazy(() => import('./pages/EntryDetailPage'))
const SourcesPage = lazy(() => import('./pages/SourcesPage'))

interface TabLinkProps {
  to: string
  end?: boolean
  children: ReactNode
}

function TabLink({ to, end, children }: TabLinkProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `px-3 py-1.5 text-xs font-medium rounded transition-colors ${
          isActive
            ? 'bg-gray-800 text-white'
            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
      Loading…
    </div>
  )
}

export default function KBApp() {
  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav tabs */}
      <nav
        className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-800 shrink-0 bg-gray-950"
        aria-label="Knowledge Base navigation"
      >
        <TabLink to="/kb" end>Dashboard</TabLink>
        <TabLink to="/kb/sources">Sources</TabLink>
      </nav>

      {/* Sub-route content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="entry/:id" element={<EntryDetailPage />} />
            <Route path="sources" element={<SourcesPage />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
