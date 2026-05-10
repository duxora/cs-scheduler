import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { schedulerApi } from '../lib/api'
import { relativeTime } from '../lib/relativeTime'
import type { Account, AccountDiscoverCandidate, AccountHealth, AccountImportPayload } from '../types'

type AccountKind = 'config_dir' | 'api_key'
type NameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'unreachable'
type ImportPlanTier = 'pro' | 'max5x' | 'max20x' | ''

type NewAccountForm = {
  name: string
  kind: AccountKind
  config_dir: string
  api_key_ref: string
  plan_tier: string
  is_default: boolean
}

const CONFIG_DIR_PLAN_OPTIONS = ['', 'pro', 'max', 'team']
const IMPORT_PLAN_OPTIONS: ImportPlanTier[] = ['', 'pro', 'max5x', 'max20x']

const HEALTH_PILL: Record<AccountHealth, { label: string; cls: string }> = {
  active: { label: '● Active', cls: 'bg-green-900/40 text-green-300' },
  idle: { label: '◐ Idle', cls: 'bg-yellow-900/40 text-yellow-300' },
  auth_failure: { label: '⚠ Re-login', cls: 'bg-red-900/40 text-red-300' },
  untested: { label: '○ Never used', cls: 'bg-gray-800 text-gray-400' },
}

function HealthPill({ health }: { health?: AccountHealth }) {
  const cfg = HEALTH_PILL[health ?? 'untested']
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cfg.cls}`}>{cfg.label}</span>
}

function deriveConfigDir(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  return slug ? `~/.claude-profiles/${slug}` : '~/.claude-profiles'
}

function getDirBasename(configDir: string) {
  return configDir.split(/[\\/]/).filter(Boolean).pop() || configDir
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
  const [showImport, setShowImport] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [nameStatus, setNameStatus] = useState<NameStatus>('idle')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'polling' | 'ready' | 'timeout'>('idle')
  const [verifyExpanded, setVerifyExpanded] = useState('')
  const [configDirManuallyEdited, setConfigDirManuallyEdited] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [discover, setDiscover] = useState<AccountDiscoverCandidate[] | null>(null)
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [picked, setPicked] = useState<AccountDiscoverCandidate | null>(null)
  const [importName, setImportName] = useState('')
  const [importPlanTier, setImportPlanTier] = useState<ImportPlanTier>('max20x')
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [skipCredentialsCheck, setSkipCredentialsCheck] = useState(false)
  const [testStatus, setTestStatus] = useState<
    Record<string, { state: 'idle' | 'running' | 'ok' | 'fail'; message?: string }>
  >({})
  const [form, setForm] = useState<NewAccountForm>(defaultForm())
  const verifyAbortRef = useRef<AbortController | null>(null)
  const statusTimeoutsRef = useRef<Record<string, number>>({})
  const discoverRequestRef = useRef(0)

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

  function resetImportModalState() {
    setPicked(null)
    setDiscover(null)
    setDiscoverLoading(false)
    setDiscoverError(null)
    setImportName('')
    setImportPlanTier('max20x')
    setImportBusy(false)
    setImportError(null)
    setSkipCredentialsCheck(false)
  }

  function closeImportModal() {
    discoverRequestRef.current += 1
    resetImportModalState()
    setShowImport(false)
  }

  function openImportModal() {
    const requestId = ++discoverRequestRef.current
    setShowImport(true)
    setPicked(null)
    setDiscover([])
    setDiscoverLoading(true)
    setDiscoverError(null)
    setImportName('')
    setImportPlanTier('max20x')
    setImportBusy(false)
    setImportError(null)
    setSkipCredentialsCheck(false)

    void (async () => {
      try {
        const result = await schedulerApi.discoverAccounts()
        if (discoverRequestRef.current !== requestId) return
        setDiscover(result.candidates)
      } catch (err) {
        if (discoverRequestRef.current !== requestId) return
        setDiscoverError(err instanceof Error ? err.message : 'Unknown error')
        setDiscover([])
      }
      if (discoverRequestRef.current !== requestId) return
      setDiscoverLoading(false)
    })()
  }

  function switchKind(kind: AccountKind) {
    setForm((prev) => ({ ...defaultForm(kind), name: prev.name, is_default: prev.is_default }))
    resetModalState()
    setActionError(null)
  }

  function setField<K extends keyof NewAccountForm>(key: K, value: NewAccountForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function pickImportCandidate(candidate: AccountDiscoverCandidate) {
    setPicked(candidate)
    setImportName(candidate.name_suggestion)
    setImportError(null)
    setImportPlanTier('max20x')
    setSkipCredentialsCheck(!candidate.has_credentials)
  }

  async function handleImportAccount() {
    if (!picked) return
    const name = importName.trim()
    if (!name) {
      setImportError('Name is required')
      return
    }

    const payload: AccountImportPayload = {
      name,
      config_dir: picked.config_dir,
      plan_tier: importPlanTier || null,
      skip_credentials_check: skipCredentialsCheck,
    }

    setImportBusy(true)
    setImportError(null)
    try {
      await schedulerApi.importAccount(payload)
      closeImportModal()
      await refresh()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportBusy(false)
    }
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
        if (!cancelled) setNameStatus('unreachable')
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

  function clearAccountStatusLater(id: string, delayMs: number) {
    const existing = statusTimeoutsRef.current[id]
    if (existing) window.clearTimeout(existing)
    statusTimeoutsRef.current[id] = window.setTimeout(() => {
      setTestStatus((s) => {
        const next = { ...s }
        delete next[id]
        return next
      })
      delete statusTimeoutsRef.current[id]
    }, delayMs)
  }

  function setAccountStatus(
    id: string,
    state: 'idle' | 'running' | 'ok' | 'fail',
    message?: string,
    clearAfterMs?: number,
  ) {
    const existing = statusTimeoutsRef.current[id]
    if (existing) {
      window.clearTimeout(existing)
      delete statusTimeoutsRef.current[id]
    }
    setTestStatus((s) => ({ ...s, [id]: { state, message } }))
    if (clearAfterMs) clearAccountStatusLater(id, clearAfterMs)
  }

  useEffect(() => {
    return () => {
      Object.values(statusTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
      statusTimeoutsRef.current = {}
    }
  }, [])

  async function handleCopyRelogin(account: Account) {
    if (!account.config_dir) return
    const cmd = `CLAUDE_CONFIG_DIR=${account.config_dir} claude /login`
    try {
      await navigator.clipboard.writeText(cmd)
      setAccountStatus(account.id, 'ok', 'Command copied', 4000)
    } catch {
      setActionError('Clipboard write failed')
    }
  }

  async function handleTest(account: Account) {
    setAccountStatus(account.id, 'running')
    try {
      const r = await schedulerApi.testAccount(account.id)
      if (r.ok) {
        setAccountStatus(account.id, 'ok', `OK (${r.took_ms}ms)`, 6000)
        await refresh()
      } else {
        const tail = (r.stderr_tail || `exit ${r.exit_code}`).slice(0, 60)
        setAccountStatus(account.id, 'fail', `✗ ${tail}`, 6000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setAccountStatus(account.id, 'fail', msg, 6000)
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openImportModal}
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded transition-colors"
          >
            Import existing
          </button>
          <button
            onClick={() => openModal('config_dir')}
            className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-3 py-1.5 rounded transition-colors"
          >
            + New account
          </button>
        </div>
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
          <ul className="space-y-2">
            {accounts.map((account) => (
              <li key={account.id} className="rounded border border-gray-800 bg-gray-900/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-100">{account.name}</span>
                      <HealthPill health={account.health} />
                      {account.is_default && (
                        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">
                          ★ default
                        </span>
                      )}
                      {account.plan_tier && (
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                          {account.plan_tier}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-500">{account.kind}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-gray-500">
                      {account.config_dir || account.api_key_ref}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
                      <span>last used {relativeTime(account.last_used_at)}</span>
                      <span>· {account.runs_24h ?? 0} runs/24h</span>
                      {(account.failures_24h ?? 0) > 0 && (
                        <span className="text-red-400">{account.failures_24h} failed</span>
                      )}
                      <span>· ${(account.cost_30d_usd ?? 0).toFixed(2)} 30d</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-400">
                      <span>{account.runs_24h ?? 0} runs/24h</span>
                      <span className={(account.failures_24h ?? 0) > 0 ? 'text-red-400' : ''}>
                        {account.failures_24h ?? 0} failures/24h
                      </span>
                      <span>${(account.cost_30d_usd ?? 0).toFixed(2)} 30d</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex items-center gap-1.5">
                        {account.kind === 'config_dir' && (
                          <button
                            onClick={() => handleCopyRelogin(account)}
                            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-700"
                          >
                            Copy re-login
                          </button>
                        )}
                        <button
                          onClick={() => handleTest(account)}
                          disabled={testStatus[account.id]?.state === 'running'}
                          className="rounded bg-blue-700 px-2 py-1 text-[10px] text-white hover:bg-blue-600 disabled:opacity-50"
                        >
                          {testStatus[account.id]?.state === 'running' ? 'Testing…' : 'Test'}
                        </button>
                        {!account.is_default && (
                          <button
                            onClick={() => handleSetDefault(account.id)}
                            className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-700"
                          >
                            Set default
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(account.id, account.name)}
                          className="rounded bg-red-900 px-2 py-1 text-[10px] text-red-100 hover:bg-red-800"
                        >
                          Delete
                        </button>
                      </div>
                      {testStatus[account.id]?.state === 'ok' && (
                        <span className="text-[10px] text-green-400">{testStatus[account.id]!.message}</span>
                      )}
                      {testStatus[account.id]?.state === 'fail' && (
                        <span className="max-w-xs truncate text-[10px] text-red-400">
                          {testStatus[account.id]!.message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
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
                        {nameStatus === 'checking'
                          ? 'checking...'
                          : nameStatus === 'available'
                            ? 'available'
                            : nameStatus === 'taken'
                              ? 'taken'
                              : 'unreachable — restart server?'}
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

      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
              <h2 className="text-sm font-medium text-gray-200">Import existing Claude account</h2>
              <button
                type="button"
                onClick={closeImportModal}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-4 space-y-4">
              {importError && (
                <div className="text-xs text-red-400 bg-red-950 border border-red-900 rounded px-3 py-2">
                  {importError}
                </div>
              )}

              {picked === null ? (
                <div className="space-y-3">
                  {discoverLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <span className="text-xs text-gray-500">Scanning…</span>
                    </div>
                  ) : discoverError ? (
                    <div className="text-xs text-red-400">{discoverError}</div>
                  ) : discover && discover.length === 0 ? (
                    <div className="text-xs text-gray-500">
                      No candidate dirs found. Use + New account to create a fresh profile.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {discover?.map((candidate) => {
                        const disabled = !candidate.dir_exists || candidate.already_registered
                        return (
                          <button
                            key={candidate.config_dir}
                            type="button"
                            disabled={disabled}
                            onClick={() => pickImportCandidate(candidate)}
                            className={`w-full rounded border px-3 py-3 text-left transition-colors ${
                              disabled
                                ? 'border-gray-800 bg-gray-900/40 opacity-50 cursor-not-allowed'
                                : 'border-gray-800 bg-gray-900/60 hover:border-gray-700 hover:bg-gray-900'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-gray-100">
                                  {getDirBasename(candidate.config_dir)}
                                </div>
                                <div className="mt-1 truncate font-mono text-[11px] text-gray-500">
                                  {candidate.config_dir}
                                </div>
                              </div>
                              <div className="flex flex-wrap justify-end gap-1.5">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                                    candidate.dir_exists ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'
                                  }`}
                                >
                                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle" />
                                  dir
                                </span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                                    candidate.has_credentials
                                      ? 'bg-green-900/40 text-green-300'
                                      : 'bg-gray-800 text-gray-400'
                                  }`}
                                >
                                  {candidate.has_credentials ? 'creds' : 'no creds'}
                                </span>
                                {candidate.has_history && (
                                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300">
                                    history
                                  </span>
                                )}
                                {candidate.already_registered && (
                                  <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-300">
                                    already registered
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded border border-gray-800 bg-gray-900/60 px-3 py-2">
                    <div className="text-[11px] text-gray-500">Selected directory</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-gray-200">{picked.config_dir}</div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label className="block text-xs text-gray-400" htmlFor="import-account-name">
                        Name *
                      </label>
                    </div>
                    <input
                      id="import-account-name"
                      type="text"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      placeholder="My Claude profile"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-xs text-gray-400">Plan tier</div>
                    <div className="flex flex-wrap gap-1.5">
                      {IMPORT_PLAN_OPTIONS.map((tier) => (
                        <button
                          key={tier || 'none'}
                          type="button"
                          onClick={() => setImportPlanTier(tier)}
                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                            importPlanTier === tier
                              ? 'bg-gray-800 text-gray-100 border-gray-700'
                              : 'bg-gray-950 text-gray-500 border-gray-800 hover:text-gray-300'
                          }`}
                        >
                          {tier || '—'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={skipCredentialsCheck}
                        disabled={!picked.has_credentials}
                        onChange={(e) => setSkipCredentialsCheck(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-0 focus:ring-offset-0 disabled:opacity-60"
                      />
                      <span className="text-xs text-gray-400">Skip credentials check</span>
                    </label>
                    <p className="text-[11px] text-gray-500">
                      {picked.has_credentials
                        ? 'Enable this only if you want to skip the post-import credential validation.'
                        : 'Credentials were not detected, so this is enabled automatically.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {picked === null ? (
                  <button
                    type="button"
                    onClick={closeImportModal}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(null)
                        setImportError(null)
                      }}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={closeImportModal}
                      className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded border border-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleImportAccount()}
                      disabled={!importName.trim() || importBusy}
                      className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded transition-colors disabled:opacity-50"
                    >
                      {importBusy ? 'Importing…' : 'Import'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
