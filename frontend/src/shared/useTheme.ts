import { useState, useEffect } from 'react'

export type Theme = 'vision' | 'deep' | 'warm' | 'slack' | 'railway'

const THEMES: Theme[] = ['vision', 'deep', 'warm', 'slack', 'railway']
const STORAGE_KEY = 'workflow-theme'
const DEFAULT: Theme = 'vision'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    return stored && THEMES.includes(stored) ? stored : DEFAULT
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const cycle = () => setTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] as Theme)

  return { theme, cycle }
}
