/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy } from 'react'
import HubShell from './layouts/HubShell'
const WorkflowApp = lazy(() => import('./apps/workflow/App'))
const TelegramApp = lazy(() => import('./apps/telegram/App'))
const KBApp = lazy(() => import('./apps/kb/App'))
const SchedulerApp = lazy(() => import('./apps/scheduler/App'))

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
        path: 'kb/*',
        element: <KBApp />,
      },
      {
        path: 'telegram-bridge/*',
        element: <TelegramApp />,
      },
    ],
  },
])
