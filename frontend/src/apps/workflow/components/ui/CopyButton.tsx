/**
 * Copy-to-clipboard button atom. Copies `command` and flips its label to
 * `copiedLabel` for 1.5s. Used for the clipboard-only tkt_claim/tkt_done
 * affordances - this app never issues those calls itself.
 */

import { useState } from 'react'
import { copyToClipboard } from '../../lib/clipboard'

interface CopyButtonProps {
  command: string
  label: string
  copiedLabel?: string
  className?: string
}

export function CopyButton({ command, label, copiedLabel = 'copied', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation()
        await copyToClipboard(command)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className={`text-xs px-1.5 py-px rounded bg-indigo-600/80 text-white hover:bg-indigo-500 shrink-0 ${className}`}
      title={`Copy: ${command}`}
    >
      {copied ? copiedLabel : label}
    </button>
  )
}
