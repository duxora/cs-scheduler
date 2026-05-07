export interface HubApp {
  id: string
  name: string
  icon: string       // emoji
  path: string       // React Router path
  description: string
  migrated: boolean  // true = renders in React, false = link to Jinja page
}

export const HUB_APPS: HubApp[] = [
  {
    id: 'workflow',
    name: 'Dev Workflow',
    icon: '🔄',
    path: '/workflow',
    description: 'Dev-to-deploy pipeline dashboard',
    migrated: true,
  },
  {
    id: 'scheduler',
    name: 'Scheduler',
    icon: '📋',
    path: '/scheduler',
    description: 'Claude task scheduler dashboard',
    migrated: true,
  },
  {
    id: 'kb',
    name: 'Knowledge Base',
    icon: '📚',
    path: '/kb',
    description: 'Local knowledge base with curated insights',
    migrated: true,
  },
  {
    id: 'stats',
    name: 'Stats',
    icon: '📊',
    path: '/stats',
    description: 'KB and automation analytics',
    migrated: true,
  },
  {
    id: 'telegram',
    name: 'Telegram Bridge',
    icon: '🤖',
    path: '/telegram-bridge',
    description: 'Two-way Telegram bot with plugin system',
    migrated: true,
  },
]
