import { NavLink, Outlet } from 'react-router-dom'

const NAV: { to: string; label: string }[] = [
  { to: 'accounts', label: 'Accounts' },
  { to: 'notifications', label: 'Notifications' },
  { to: 'defaults', label: 'Defaults' },
  { to: 'budgets', label: 'Budgets' },
]

export default function SettingsLayout() {
  return (
    <div className="flex h-full bg-gray-950 text-gray-100">
      <aside className="w-44 shrink-0 border-r border-gray-800 px-2 py-3">
        <h2 className="mb-2 px-2 text-[11px] uppercase tracking-wide text-gray-500">Settings</h2>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded px-2 py-1.5 text-xs transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </section>
    </div>
  )
}
