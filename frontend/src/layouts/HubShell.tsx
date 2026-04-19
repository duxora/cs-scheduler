import { Outlet } from 'react-router-dom'
import { Suspense, useState } from 'react'
import Sidebar from './Sidebar'
import { useTheme } from '../shared/useTheme'
import { ThemeContext } from '../shared/ThemeContext'

export default function HubShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { theme, cycle } = useTheme()

  return (
    <ThemeContext.Provider value={{ theme, cycle }}>
      <div
        className="flex min-h-screen text-gray-100"
        data-workflow-theme={theme}
        style={{ background: 'var(--hub-shell-bg)' }}
      >
        {/* Mobile menu button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed top-2 left-2 z-50 lg:hidden p-2 rounded-lg border text-gray-300 hover:text-white"
          style={{ background: 'var(--hub-sidebar-bg)', borderColor: 'var(--hub-sidebar-bdr)' }}
          aria-label="Open menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div className={`
          fixed inset-y-0 left-0 z-40 transition-transform duration-200
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>

        <main className="flex-1 overflow-y-auto min-w-0 wf-main-canvas">
          <Suspense fallback={<div className="p-6 text-sm" style={{ color: 'var(--hub-text)' }}>Loading...</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </ThemeContext.Provider>
  )
}
