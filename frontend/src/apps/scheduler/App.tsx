import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import ErrorsPage from './pages/ErrorsPage'
import TicketsPage from './pages/TicketsPage'
import NotificationsPage from './pages/NotificationsPage'
import DoctorPage from './pages/DoctorPage'
import ApprovalsPage from './pages/ApprovalsPage'
import TaskDetailPage from './pages/TaskDetailPage'
import TaskNewPage from './pages/TaskNewPage'
import SettingsLayout from './pages/settings/SettingsLayout'
import AccountsTab from './pages/settings/AccountsTab'
import NotificationsTab from './pages/settings/NotificationsTab'
import DefaultsTab from './pages/settings/DefaultsTab'
import BudgetsTab from './pages/settings/BudgetsTab'

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

export default function SchedulerApp() {
  return (
    <div className="flex flex-col h-full">
      {/* Sub-nav tabs */}
      <nav className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-800 shrink-0 bg-gray-950">
        <TabLink to="/scheduler" end>Dashboard</TabLink>
        <TabLink to="/scheduler/history">History</TabLink>
        <TabLink to="/scheduler/errors">Errors</TabLink>
        <TabLink to="/scheduler/tickets">Tickets</TabLink>
        <TabLink to="/scheduler/notifications">Notifications</TabLink>
        <TabLink to="/scheduler/doctor">Doctor</TabLink>
        <TabLink to="/scheduler/approvals">Approvals</TabLink>
        <TabLink to="/scheduler/settings">Settings</TabLink>
      </nav>

      {/* Sub-route content */}
      <div className="flex-1 min-h-0">
        <Routes>
          <Route index element={<DashboardPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="errors" element={<ErrorsPage />} />
          <Route path="tickets" element={<TicketsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="doctor" element={<DoctorPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="accounts" element={<Navigate to="/scheduler/settings/accounts" replace />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="accounts" replace />} />
            <Route path="accounts" element={<AccountsTab />} />
            <Route path="notifications" element={<NotificationsTab />} />
            <Route path="defaults" element={<DefaultsTab />} />
            <Route path="budgets" element={<BudgetsTab />} />
          </Route>
          <Route path="tasks/new" element={<TaskNewPage />} />
          <Route path="tasks/:slug" element={<TaskDetailPage />} />
          <Route path="*" element={<Navigate to="/scheduler" replace />} />
        </Routes>
      </div>
    </div>
  )
}
