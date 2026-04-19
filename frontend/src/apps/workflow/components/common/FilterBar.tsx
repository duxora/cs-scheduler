/**
 * FilterBar — compound component for horizontal filter rows.
 *
 * Usage:
 *   <FilterBar>
 *     <FilterBar.Search value={q} onChange={setQ} placeholder="Search…" onClear={() => setQ('')} />
 *     <FilterBar.Select value={status} onChange={setStatus} aria-label="Status">
 *       <option value="">All</option>
 *     </FilterBar.Select>
 *     <FilterBar.Count>{n} items</FilterBar.Count>
 *   </FilterBar>
 *
 * The container accepts optional `style` / `className` overrides so callers can
 * pass tokenized CSS variables (var(--wf-border), var(--wf-bg-surface)) without
 * the compound component hard-coding them.
 */

import type { ReactNode, SelectHTMLAttributes, CSSProperties } from 'react'
import { SearchIcon, CloseIcon } from '../ui/icons'

// ── Container ─────────────────────────────────────────────────────────────────

interface FilterBarProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

function FilterBar({ children, className, style }: FilterBarProps) {
  return (
    <div
      className={[
        'flex flex-wrap items-center gap-2 px-4 py-2.5 shrink-0 border-b',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {children}
    </div>
  )
}

// ── Select ─────────────────────────────────────────────────────────────────────

interface FilterBarSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode
  /** Override the full className — defaults to a consistent dark-themed select */
  selectClassName?: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FilterBarSelect({ children, selectClassName, className: _className, ...rest }: FilterBarSelectProps) {
  return (
    <select
      className={
        selectClassName ??
        'text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-300 focus:border-blue-500/60 focus:outline-none transition-all'
      }
      {...rest}
    >
      {children}
    </select>
  )
}

// ── Search ─────────────────────────────────────────────────────────────────────

interface FilterBarSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Called when the ✕ clear button is clicked. If omitted the clear button is hidden. */
  onClear?: () => void
  /** Override the full className of the <input> */
  inputClassName?: string
}

function FilterBarSearch({ value, onChange, placeholder, onClear, inputClassName }: FilterBarSearchProps) {
  return (
    <div className="relative">
      <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          inputClassName ??
          'text-xs bg-slate-800/80 border border-slate-700/60 rounded-lg pl-7 pr-3 py-1.5 text-slate-200 w-full sm:w-48 placeholder-slate-600 focus:border-blue-500/60 focus:bg-slate-800 focus:outline-none transition-all'
        }
      />
      {value && onClear && (
        <button
          onClick={onClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

// ── Count ─────────────────────────────────────────────────────────────────────

interface FilterBarCountProps {
  children: ReactNode
  className?: string
}

function FilterBarCount({ children, className }: FilterBarCountProps) {
  return (
    <div className="ml-auto flex items-center gap-2">
      <span
        className={[
          'text-[11px] text-gray-500 tabular-nums',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </span>
    </div>
  )
}

// ── Attach sub-components ──────────────────────────────────────────────────────

const FilterBarCompound = Object.assign(FilterBar, {
  Select: FilterBarSelect,
  Search: FilterBarSearch,
  Count:  FilterBarCount,
})

export default FilterBarCompound
