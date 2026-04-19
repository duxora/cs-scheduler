import { NavLink } from 'react-router-dom'
import { HUB_APPS } from '../shared/apps'
import { useThemeContext } from '../shared/ThemeContext'
import type { Theme } from '../shared/useTheme'

interface SidebarProps {
  onNavigate?: () => void
}

const THEME_META: Record<Theme, { icon: string; label: string }> = {
  vision:  { icon: '✦',  label: 'Vision'  },
  deep:    { icon: '🌙', label: 'Deep'    },
  warm:    { icon: '🪨', label: 'Warm'    },
  slack:   { icon: '💬', label: 'Slack'   },
  railway: { icon: '🚂', label: 'Railway' },
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const { theme, cycle } = useThemeContext()
  const meta = THEME_META[theme]

  return (
    <aside
      className="w-56 min-h-screen flex flex-col shrink-0 border-r"
      style={{
        background:   'var(--hub-sidebar-bg)',
        borderColor:  'var(--hub-sidebar-bdr)',
      }}
    >
      {/* Brand */}
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--hub-sidebar-bdr)' }}>
        <span className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--hub-text-active)' }}>
          Automation Hub
        </span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3">
        <ul className="space-y-0.5 px-2">
          {HUB_APPS.map((app) => {
            const label = (
              <>
                <span className="text-base leading-none" aria-hidden="true">{app.icon}</span>
                <span className="text-sm font-medium">{app.name}</span>
              </>
            )

            const baseStyle = 'flex items-center gap-3 w-full rounded-md px-3 py-2 transition-colors'

            if (app.migrated) {
              return (
                <li key={app.id}>
                  <NavLink
                    to={app.path}
                    onClick={onNavigate}
                    aria-label={app.description}
                    className={baseStyle}
                    style={({ isActive }) => ({
                      background: isActive ? 'var(--hub-active-bg)' : undefined,
                      color: isActive ? 'var(--hub-text-active)' : 'var(--hub-text)',
                    })}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget
                      if (!el.classList.contains('active')) {
                        el.style.background = 'var(--hub-hover-bg)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget
                      if (!el.classList.contains('active')) {
                        el.style.background = ''
                      }
                    }}
                  >
                    {label}
                  </NavLink>
                </li>
              )
            }

            return (
              <li key={app.id}>
                <a
                  href={app.path}
                  onClick={onNavigate}
                  className={baseStyle}
                  style={{ color: 'var(--hub-text)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hub-hover-bg)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                  aria-label={app.description}
                >
                  {label}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Theme toggle */}
      <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--hub-sidebar-bdr)' }}>
        <button
          onClick={cycle}
          title="Cycle theme"
          className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-xs transition-colors"
          style={{ color: 'var(--hub-text)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hub-hover-bg)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
        >
          <span className="text-sm">{meta.icon}</span>
          <span>{meta.label}</span>
          <span className="ml-auto opacity-40">⇄</span>
        </button>
      </div>
    </aside>
  )
}
