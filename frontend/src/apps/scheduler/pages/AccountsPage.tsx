import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { schedulerApi } from '../lib/api'

type AccountKind = 'config_dir' | 'api_key'

type NewAccountForm = {
  name: string
  kind: AccountKind
  config_dir: string
  api_key_ref: string
  plan_tier: string
  is_default: boolean
}

const CONFIG_DIR_PLAN_OPTIONS = ['', 'pro', 'max', 'team']

function deriveConfigDir(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return slug ? `~/.claude-profiles/${slug}` : '~/.claude-profiles'
}

function defaultForm(kind: AccountKind = 'config_dir'): NewAccountForm {
  return {
    name: '',
    kind,
    config_dir: '',
    api_key_ref: 'keychain:claude-scheduler-myaccount',
    plan_tier: kind === 'api_key' ? 'api' : '',
    is_default: false,
  }
}

export default function AccountsPage() {
  const navigate = useNavigate()
  const { accounts, loading, error, refresh } = useAccounts()
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'polling' | 'ready' | 'timeout'>('idle')
  const [verifyExpanded, setVerifyExpanded] = useState('')
  const [configDirManuallyEdited, setConfigDirManuallyEdited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [form, setForm] = useState<NewAccountForm>(defaultForm())
  const verifyAbortRef = useRef<AbortController | null>(null)

  function openModal(kind: AccountKind = 'config_dir') {
    setForm(defaultForm(kind))
    setStep(1)
    setNameStatus('idle')
    setVerifyStatus('idle')
    setVerifyExpanded('')
    setConfigDirManuallyEdited(false)
    setActionError(null)
    setShowModal(true)
  }

  function resetModalState() {
    verifyAbortRef.current?.abort()
    verifyAbortRef.current = null
    setStep(1)
    setNameStatus('idle')
    setVerifyStatus('idle')
    setVerifyExpanded('')
    setConfigDirManuallyEdited(false)
  }

  function closeModal() {
    resetModalState()
    setActionError(null)
    setShowModal(false)
  }

  function switchKind(kind: AccountKind) {
    setForm((prev) => ({ ...defaultForm(kind), name: prev.name, is_default: prev.is_default }))
    resetModalState()
    setActionError(null)
  }

  function setField<K extends keyof NewAccountForm>(key: K, value: NewAccountForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    if (!showModal) return

    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setNameStatus('idle')
      return
    }

    setNameStatus('checking')
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await schedulerApi.checkAccountName(trimmedName)
        if (!cancelled) setNameStatus(result.available ? 'available' : 'taken')
      } catch {
        if (!cancelled) setNameStatus('idle')
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form.name, showModal])

  useEffect(() => {
    if (!showModal || form.kind !== 'config_dir' || configDirManuallyEdited) return

    const derivedConfigDir = deriveConfigDir(form.name)
    setForm((prev) => (prev.config_dir === derivedConfigDir ? prev : { ...prev, config_dir: derivedConfigDir }))
  }, [configDirManuallyEdited, form.kind, form.name, showModal])

  async function handleCreateApiKey() {
    if (!form.name.trim()) {
      setActionError('Name is required')
      return
    }
    if (nameStatus !== 'available') {
      setActionError('Name must be available')
      return
    }
    if (!form.api_key_ref.trim()) {
      setActionError('API key reference is required')
      return
    }

    setSubmitting(true)
    setActionError(null)
    try {
      await schedulerApi.createAccount({
        name: form.name.trim(),
        kind: 'api_key',
        api_key_ref: form.api_key_ref.trim(),
        plan_tier: 'api',
        is_default: form.is_default,
      })
      closeModal()
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setActionError(null)

    if (!form.name.trim()) {
      setActionError('Name is required')
      return
    }
    if (nameStatus !== 'available') {
      setActionError('Name must be available')
      return
    }

    if (form.kind === 'api_key') {
      await handleCreateApiKey()
      return
    }

    if (!form.config_dir.trim()) {
      setActionError('Config directory is required')
      return
    }

    if (step === 1) {
      setStep(2)
      setVerifyStatus('idle')
      setVerifyExpanded('')
    }
  }

  async function runVerify() {
    const configDir = form.config_dir.trim()
    if (!configDir) {
      setActionError('Config directory is required')
      return
    }

    verifyAbortRef.current?.abort()
    const controller = new AbortController()
    verifyAbortRef.current = controller

    setActionError(null)
    setVerifyStatus('polling')

    const start = Date.now()
    while (Date.now() - start < 60_000 && !controller.signal.aborted) {
      try {
        const result = await schedulerApi.checkAccountCredentials(configDir)
        if (controller.signal.aborted) return

        setVerifyExpanded(result.expanded_path)
        if (result.has_credentials) {
          setVerifyStatus('ready')
          try {
            await schedulerApi.createAccount({
              name: form.name.trim(),
              kind: 'config_dir',
              config_dir: result.expanded_path,
              plan_tier: form.plan_tier || null,
              is_default: form.is_default,
            })
            closeModal()
            await refresh()
            return
          } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Unknown error')
            return
          }
        }
      } catch {
        // swallow transient errors during polling
      }

      if (controller.signal.aborted) return
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
    }

    if (!controller.signal.aborted) setVerifyStatus('timeout')
  }

  const loginCmd = `mkdir -p ${verifyExpanded || form.config_dir} && CLAUDE_CONFIG_DIR=${verifyExpanded || form.config_dir} claude /login`

  async function handleSetDefault(id: string) {
    setActionError(null)
    try {
      await schedulerApi.setDefaultAccount(id)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete account "${name}"?`)) return
    setActionError(null)
    try {
      await schedulerApi.deleteAccount(id)
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-100 overflow-y-auto">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/scheduler')}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back
          </button>
          <span className="text-gray-700">/</span>
          <h1 className="text-sm font-medium text-gray-200">Accounts</h1>
        </div>
        <button
          onClick={() => openModal('config_dir')}
          className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded transition-colors"
        >
          + New account
        </button>
      </div>

      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {actionError && (
          <div className="mb-3 text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2">
            {actionError}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-gray-600">Loading accounts...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-red-400">Failed to load accounts</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <span className="text-xs text-gray-600">No accounts found</span>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-1.5 pr-4 font-medium">Name</th>
                <th className="text-left py-1.5 pr-4 font-medium">Kind</th>
                <th className="text-left py-1.5 pr-4 font-medium">Plan</th>
                <th className="text-left py-1.5 pr-4 font-medium">Created</th>
                <th className="text-left py-1.5 pr-4 font-medium">Last used</th>
                <th className="text-left py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id} className="border-b border-gray-900 hover:bg-gray-900/40">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      {account.is_default ? (
                        <span className="inline-flex h-2 w-2 rounded-full bg-green-400" aria-hidden="true" />
                      ) : (
                        <span className="inline-flex h-2 w-2 rounded-full bg-gray-700" aria-hidden="true" />
                      )}
                      <span className="text-gray-200">{account.name}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-gray-400">
                    {account.kind === 'config_dir' ? 'profile' : 'api key'}
                  </td>
                  <td className="py-2 pr-4 text-gray-400">{account.plan_tier ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-400">{new Date(account.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-gray-400">
                    {account.last_used_at ? new Date(account.last_used_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      {!account.is_default && (
                        <button
                          onClick={() => handleSetDefault(account.id)}
                          className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-0.5 rounded border border-gray-700 transition-colors"
                        >
                          Set default
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(account.id, account.name)}
                        className="text-[10px] bg-red-900 hover:bg-red-800 text-red-100 px-2 py-0.5 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-gray-200">New account</h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => switchKind('config_dir')}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${form.kind === 'config_dir' ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-gray-950 text-gray-500 border-gray-800 hover:text-gray-300'}`}
                  >
                    config_dir
                  </button>
                  <button
                    type="button"
                    onClick={() => switchKind('api_key')}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${form.kind === 'api_key' ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-gray-950 text-gray-500 border-gray-800 hover:text-gray-300'}`}
                  >
                    api_key
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
              {actionError && (
                <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2">
                  {actionError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="block text-xs text-gray-400" htmlFor="account-name">Name *</label>
                    {nameStatus !== 'idle' && (
                      <span
                        className={`text-[10px] ${
                          nameStatus === 'checking'
                            ? 'text-gray-500'
                            : nameStatus === 'available'
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}
                      >
                        {nameStatus === 'checking' ? 'checking...' : nameStatus === 'available' ? 'available' : 'taken'}
                      </span>
                    )}
                  </div>
                  <input
                    id="account-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="My Claude profile"
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                {form.kind === 'config_dir' ? (
                  step === 1 ? (
                    <>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-400 mb-1" htmlFor="config-dir">Config dir *</label>
                        <input
                          id="config-dir"
                          type="text"
                          value={form.config_dir}
                          onChange={(e) => {
                            setConfigDirManuallyEdited(true)
                            setField('config_dir', e.target.value)
                          }}
                          placeholder="~/.claude-profiles/my-profile"
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-gray-400 mb-1" htmlFor="plan-tier">Plan tier</label>
                        <select
                          id="plan-tier"
                          value={form.plan_tier}
                          onChange={(e) => setField('plan_tier', e.target.value)}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
                        >
                          {CONFIG_DIR_PLAN_OPTIONS.map((tier) => (
                            <option key={tier || 'empty'} value={tier}>
                              {tier || '(none)'}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 space-y-3">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Run this in a terminal:</label>
                        <div className="relative">
                          <pre className="bg-gray-900 border border-gray-700 rounded p-3 text-xs text-gray-200 whitespace-pre overflow-x-auto">
                            {loginCmd}
                          </pre>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(loginCmd)}
                            className="absolute top-1.5 right-1.5 text-[10px] px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">
                          The browser will open. Sign in with your Anthropic account, then come back here and click <em>Verify</em>.
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={runVerify}
                          disabled={verifyStatus === 'polling'}
                          className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
                        >
                          {verifyStatus === 'polling' ? 'Verifying…' : 'Verify'}
                        </button>
                        {verifyStatus === 'ready' && <span className="text-xs text-green-400">✓ credentials detected</span>}
                        {verifyStatus === 'timeout' && <span className="text-xs text-red-400">no credentials yet — try again</span>}
                      </div>
                    </div>
                  )
                ) : (
                  <>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-400 mb-1" htmlFor="api-key-ref">API key reference *</label>
                      <input
                        id="api-key-ref"
                        type="text"
                        value={form.api_key_ref}
                        onChange={(e) => setField('api_key_ref', e.target.value)}
                        placeholder="keychain:claude-scheduler-myaccount"
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <input type="hidden" value="api" readOnly aria-hidden="true" />
                  </>
                )}

                <div className="flex items-center gap-2 col-span-2">
                  <input
                    id="is-default"
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setField('is_default', e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-0 focus:ring-offset-0"
                  />
                  <label htmlFor="is-default" className="text-xs text-gray-400">
                    Default account
                  </label>
                </div>
              </div>

              <div className="text-[11px] text-gray-500 space-y-2">
                {form.kind === 'config_dir' ? (
                  <p>
                    Run <span className="font-mono text-gray-300">CLAUDE_CONFIG_DIR=&#60;config_dir&#62; claude /login</span> in a terminal once before this account can be used. The scheduler never sees the OAuth token.
                  </p>
                ) : (
                  <p>
                    Reference an existing macOS Keychain entry (<span className="font-mono text-gray-300">keychain:&#60;service&#62;</span>) or 1Password item (<span className="font-mono text-gray-300">op://&#60;vault&#62;/&#60;item&#62;/&#60;field&#62;</span>). The scheduler never stores the plaintext.
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                {form.kind === 'config_dir' && step === 2 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setStep(1)
                        setVerifyStatus('idle')
                        setVerifyExpanded('')
                        verifyAbortRef.current?.abort()
                      }}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={
                        form.kind === 'config_dir'
                          ? step === 1 && (submitting || !form.name.trim() || nameStatus !== 'available' || !form.config_dir.trim())
                          : submitting || !form.name.trim() || nameStatus !== 'available' || !form.api_key_ref.trim()
                      }
                      className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors disabled:opacity-50"
                    >
                      {form.kind === 'config_dir'
                        ? step === 1
                          ? 'Next'
                          : 'Create account'
                        : submitting
                          ? 'Creating...'
                          : 'Create account'}
                    </button>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
