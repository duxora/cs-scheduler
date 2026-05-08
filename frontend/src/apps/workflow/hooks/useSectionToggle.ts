import { useCallback, useState } from 'react'

/**
 * Persistent section collapse/expand toggle backed by localStorage.
 * Key is namespaced automatically: `wf.section.<key>.expanded`
 */
export function useSectionToggle(key: string, defaultExpanded = true): [boolean, () => void] {
  const storageKey = `wf.section.${key}.expanded`

  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored !== null ? stored === 'true' : defaultExpanded
    } catch {
      return defaultExpanded
    }
  })

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      try { localStorage.setItem(storageKey, String(next)) } catch {}
      return next
    })
  }, [storageKey])

  return [expanded, toggle]
}
