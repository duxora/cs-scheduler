import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { schedulerApi } from '../lib/api'
import type { TaskKind } from '../types'

const MODEL_OPTIONS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-6',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
]

const DEFAULT_TOOLS = 'Read,Grep,Glob'

export default function TaskNewPage() {
  const navigate = useNavigate()
  const { accounts } = useAccounts()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    name: '',
    schedule: '0 9 * * *',
    kind: 'default' as TaskKind,
    prompt: '',
    model: 'claude-sonnet-4-6',
    max_turns: 10,
    timeout: 300,
    tools: DEFAULT_TOOLS,
    account: '',
    workdir: '',
    enabled: true,
  })

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const prefillBrainstorm = () => {
    setForm((f) => ({
      ...f,
      kind: 'brainstorm',
      model: 'opus',
      schedule: 'manual',
      tools: 'Read,Bash,Edit,Write',
    }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.schedule.trim() || !form.prompt.trim()) {
      setError('Name, schedule, and prompt are required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await schedulerApi.createTask({
        ...form,
        kind: form.kind,
        account: form.account,
      })
      if (res.ok || res.redirected) {
        // Backend redirects to /scheduler/tasks/{slug}; navigate to dashboard
        navigate('/scheduler')
      } else {
        setError(`Server error: ${res.status}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800 shrink-0">
        <button
          onClick={() => navigate('/scheduler')}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Back
        </button>
        <span className="text-gray-700">/</span>
        <h1 className="text-sm font-medium text-gray-200">New Task</h1>
      </div>

      <div className="mb-4 flex items-center justify-between px-4 pt-4">
        <h1 className="text-sm text-gray-200">New scheduled task</h1>
        <button
          type="button"
          onClick={prefillBrainstorm}
          className="text-xs px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded"
        >
          Brainstorm with Opus
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-4 space-y-4 overflow-y-auto max-w-2xl">
        {error && (
          <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <div className="col-span-2">
            <label className="block text-xs text-gray-400 mb-1" htmlFor="name">Name *</label>
            <input
              id="name"
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              required
              placeholder="My daily task"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="schedule">Schedule (cron) *</label>
            <input
              id="schedule"
              type="text"
              value={form.schedule}
              onChange={(e) => setField('schedule', e.target.value)}
              required
              placeholder="0 9 * * *"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="model">Model</label>
            <select
              id="model"
              value={form.model}
              onChange={(e) => setField('model', e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Max turns */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="max_turns">Max turns</label>
            <input
              id="max_turns"
              type="number"
              min={1}
              max={100}
              value={form.max_turns}
              onChange={(e) => setField('max_turns', Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Timeout */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="timeout">Timeout (seconds)</label>
            <input
              id="timeout"
              type="number"
              min={30}
              max={3600}
              value={form.timeout}
              onChange={(e) => setField('timeout', Number(e.target.value))}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Tools */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="tools">Tools (comma-separated)</label>
            <input
              id="tools"
              type="text"
              value={form.tools}
              onChange={(e) => setField('tools', e.target.value)}
              placeholder="Read,Grep,Glob"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-600 focus:outline-none"
            />
          </div>

          {/* Kind */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="kind">Kind</label>
            <select
              id="kind"
              value={form.kind}
              onChange={(e) => setField('kind', e.target.value as typeof form.kind)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
            >
              <option value="default">Default — run prompt as-is</option>
              <option value="advisor">Advisor — Opus, structured advice</option>
              <option value="brainstorm">Brainstorm — Opus, fan out to 3 actions</option>
            </select>
          </div>

          {/* Account */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="account">Account</label>
            <div className="flex items-center gap-2">
              <select
                id="account"
                value={form.account}
                onChange={(e) => setField('account', e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
              >
                <option value="">(default)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}{a.is_default ? ' • default' : ''} — {a.kind === 'config_dir' ? 'profile' : 'api key'}{a.plan_tier ? ` · ${a.plan_tier}` : ''}
                  </option>
                ))}
              </select>
              <a href="/scheduler/settings/accounts" className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap">+ New</a>
            </div>
          </div>

          {/* Workdir */}
          <div>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="workdir">Working directory</label>
            <input
              id="workdir"
              type="text"
              value={form.workdir}
              onChange={(e) => setField('workdir', e.target.value)}
              placeholder="/path/to/project"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setField('enabled', !form.enabled)}
            aria-pressed={form.enabled}
            aria-label="Enable task"
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.enabled ? 'bg-green-600' : 'bg-gray-700'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-xs text-gray-400">Enabled</span>
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs text-gray-400 mb-1" htmlFor="prompt">Prompt *</label>
          <textarea
            id="prompt"
            value={form.prompt}
            onChange={(e) => setField('prompt', e.target.value)}
            required
            rows={12}
            placeholder="Describe what this task should do..."
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-600 focus:outline-none resize-y"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-2 pb-4">
          <button
            type="submit"
            disabled={submitting}
            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/scheduler')}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
