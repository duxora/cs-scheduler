/**
 * Generic multi-select chip group - several toggleable pills, any subset
 * selectable. Companion to SegmentedControl (which is single-select only).
 * Selecting none is a valid, meaningful state (the caller decides what it
 * means - typically "no filtering").
 */

interface ChipOption<T extends string> {
  value: T
  label: string
  /** Active-state color classes; falls back to a neutral indigo chip. */
  activeCls?: string
}

interface MultiSelectChipsProps<T extends string> {
  options: readonly ChipOption<T>[]
  selected: readonly T[]
  onChange: (next: T[]) => void
  containerClassName?: string
}

const DEFAULT_ACTIVE_CLS = 'bg-indigo-900/50 text-indigo-200 border-indigo-600/60'

export function MultiSelectChips<T extends string>({
  options,
  selected,
  onChange,
  containerClassName = '',
}: MultiSelectChipsProps<T>) {
  const selectedSet = new Set(selected)

  const toggle = (value: T) => {
    if (selectedSet.has(value)) onChange(selected.filter((v) => v !== value))
    else onChange([...selected, value])
  }

  return (
    <div className={`flex items-center gap-1 flex-wrap ${containerClassName}`}>
      {options.map((opt) => {
        const active = selectedSet.has(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            aria-pressed={active}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              active
                ? (opt.activeCls ?? DEFAULT_ACTIVE_CLS)
                : 'text-slate-400 border-slate-700/50 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
