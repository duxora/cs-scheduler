/**
 * Generic segmented control component for selecting between discrete options.
 * Used for filtering controls like period, pipeline, size selections.
 */

interface Option<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  options: readonly Option<T>[]
  value: T
  onChange: (value: T) => void
  /** Optional additional classes for the container */
  containerClassName?: string
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  containerClassName = '',
}: SegmentedControlProps<T>) {
  return (
    <div className={`flex items-center gap-1 ${containerClassName}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs rounded transition-colors ${
            value === opt.value
              ? 'bg-gray-700 text-white'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
