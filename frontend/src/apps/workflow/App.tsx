import { NavLink, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import TaskBoard from './components/TaskBoard'
import ProjectsPage from './pages/ProjectsPage'
import EpicsPage from './pages/EpicsPage'
import PipelinesPage from './pages/PipelinesPage'
import SessionsPage from './pages/SessionsPage'
import InsightsPage from './pages/InsightsPage'
import TaskTreePage from './pages/TaskTreePage'
import { useThemeContext } from '../../shared/ThemeContext'

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
            ? 'text-white'
            : 'hover:text-gray-300'
        }`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--hub-active-bg)' : undefined,
        color: isActive ? 'var(--hub-text-active)' : 'var(--hub-text)',
      })}
    >
      {children}
    </NavLink>
  )
}

export default function WorkflowApp() {
  useThemeContext()

  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav tabs */}
      <nav
        className="flex items-center gap-1 px-4 py-1.5 border-b shrink-0"
        style={{ background: 'var(--hub-nav-bg)', borderColor: 'var(--hub-nav-bdr)' }}
      >
        <TabLink to="/workflow/projects">Projects</TabLink>
        <TabLink to="/workflow/epics">Epics</TabLink>
        <TabLink to="/workflow" end>Tasks</TabLink>
        <TabLink to="/workflow/pipelines">Pipelines</TabLink>
        <TabLink to="/workflow/sessions">Sessions</TabLink>
        <TabLink to="/workflow/insights">Insights</TabLink>
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
        </Routes>
      </div>
    </div>
  )
}
