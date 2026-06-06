/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy } from 'react'
import HubShell from './layouts/HubShell'
const WorkflowApp = lazy(() => import('./apps/workflow/App'))
const TelegramApp = lazy(() => import('./apps/telegram/App'))
const KBApp = lazy(() => import('./apps/kb/App'))
const SchedulerApp = lazy(() => import('./apps/scheduler/App'))
const AccountsApp = lazy(() => import('./apps/accounts/App'))
const StatsApp = lazy(() => import('./apps/stats/App'))
const SplannerApp = lazy(() => import('./apps/splanner/App'))

export const router = createBrowserRouter([
  {
    element: <HubShell />,
    children: [
      { index: true, element: <Navigate to="/workflow" replace /> },
      {
        path: 'workflow/*',
        element: <WorkflowApp />,
      },
      {
        path: 'scheduler/*',
        element: <SchedulerApp />,
      },
      {
        path: 'accounts/*',
        element: <AccountsApp />,
      },
      {
        path: 'kb/*',
        element: <KBApp />,
      },
      {
        path: 'stats/*',
        element: <StatsApp />,
      },
      {
        path: 'splanner/*',
        element: <SplannerApp />,
      },
      {
        path: 'telegram-bridge/*',
        element: <TelegramApp />,
      },
    ],
  },
])
