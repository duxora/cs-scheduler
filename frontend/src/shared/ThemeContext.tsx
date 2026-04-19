import { createContext, useContext } from 'react'
import type { Theme } from './useTheme'

interface ThemeContextValue {
  theme: Theme
  cycle: () => void
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'vision',
  cycle: () => {},
})

export const useThemeContext = () => useContext(ThemeContext)
