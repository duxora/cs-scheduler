import { NavLink, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { type ReactNode, useEffect } from 'react'
import TaskBoard from './components/TaskBoard'
import ProjectsPage from './pages/ProjectsPage'
import EpicsPage from './pages/EpicsPage'
import PipelinesPage from './pages/PipelinesPage'
import SessionsPage from './pages/SessionsPage'
import InsightsPage from './pages/InsightsPage'
import TaskTreePage from './pages/TaskTreePage'
import EpicDetailPage from './pages/EpicDetailPage'
import { useThemeContext } from '../../shared/ThemeContext'

// ── Nav icons ──────────────────────────────────────────────────────────────

function IconTasks() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  )
}

function IconProjects() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}

function IconEpics() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

function IconPipelines() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7" /><path d="M6 9v12" />
    </svg>
  )
}

function IconSessions() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function IconInsights() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

// ── Tab URL persistence ────────────────────────────────────────────────────

const TAB_BASES = [
  '/workflow',
  '/workflow/projects',
  '/workflow/epics',
  '/workflow/pipelines',
  '/workflow/sessions',
  '/workflow/insights',
]

function tabKey(base: string) {
  return `wf.tab.${base}`
}

function saveTabUrl(base: string, url: string) {
  try { sessionStorage.setItem(tabKey(base), url) } catch { /* ignore */ }
}

function getTabUrl(base: string): string {
  try { return sessionStorage.getItem(tabKey(base)) ?? base } catch { return base }
}

function useTabUrlSaver() {
  const location = useLocation()
  useEffect(() => {
    const base = TAB_BASES.find((b) =>
      b === '/workflow'
        ? location.pathname === '/workflow' || location.pathname === '/workflow/'
        : location.pathname === b || location.pathname === b + '/'
    )
    if (base) saveTabUrl(base, location.pathname + location.search)
  }, [location])
}

// ── Tab link ───────────────────────────────────────────────────────────────

interface TabLinkProps {
  to: string
  end?: boolean
  icon: ReactNode
  children: ReactNode
}

function TabLink({ to, end, icon, children }: TabLinkProps) {
  const navigate = useNavigate()
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all shrink-0 ${
          isActive ? '' : 'hover:bg-white/5'
        }`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--hub-active-bg)' : undefined,
        color: isActive ? 'var(--hub-text-active)' : 'var(--hub-text)',
      })}
      onClick={(e) => {
        e.preventDefault()
        navigate(getTabUrl(to))
      }}
    >
      <span className="shrink-0 opacity-75">{icon}</span>
      {children}
    </NavLink>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function WorkflowApp() {
  useThemeContext()
  useTabUrlSaver()

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav tabs */}
      <nav
        className="flex items-center gap-0.5 px-3 py-1.5 border-b shrink-0 overflow-x-auto"
        style={{ background: 'var(--hub-nav-bg)', borderColor: 'var(--hub-nav-bdr)' }}
      >
        <TabLink to="/workflow" end icon={<IconTasks />}>Tasks</TabLink>
        <TabLink to="/workflow/projects" icon={<IconProjects />}>Projects</TabLink>
        <TabLink to="/workflow/epics" icon={<IconEpics />}>Epics</TabLink>
        <TabLink to="/workflow/pipelines" icon={<IconPipelines />}>Pipelines</TabLink>
        <TabLink to="/workflow/sessions" icon={<IconSessions />}>Sessions</TabLink>
        <TabLink to="/workflow/insights" icon={<IconInsights />}>Insights</TabLink>
      </nav>

      {/* Sub-route content */}
      <div className="flex-1 min-h-0">
        <Routes>
          <Route index element={<TaskBoard />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="epics" element={<EpicsPage />} />
          <Route path="pipelines" element={<PipelinesPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="tree/:id" element={<TaskTreePage />} />
          <Route path="epics/:id" element={<EpicDetailPage />} />
        </Routes>
      </div>
    </div>
  )
}
