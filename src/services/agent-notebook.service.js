import { query } from '../db/pool.js'

export const DEFAULT_NOTEBOOK = {
  version: 1,
  categories: [{ id: 'cat-default', name: 'عملاء' }],
  accounts: [],
  vouchers: [],
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeCategory(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim()
  if (!name) return null
  return {
    id: String(raw.id || '').trim() || createId('cat'),
    name,
  }
}

function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || '').trim()
  const categoryId = String(raw.categoryId || '').trim()
  if (!name || !categoryId) return null
  return {
    id: String(raw.id || '').trim() || createId('acc'),
    categoryId,
    name,
    phone: String(raw.phone || '').trim(),
    notes: String(raw.notes || '').trim(),
    ceiling: Math.max(0, Number(raw.ceiling) || 0),
  }
}

function normalizeVoucher(raw) {
  if (!raw || typeof raw !== 'object') return null
  const accountId = String(raw.accountId || '').trim()
  const type = raw.type === 'payment' ? 'payment' : raw.type === 'receipt' ? 'receipt' : ''
  const amount = Number(raw.amount)
  if (!accountId || !type || !Number.isFinite(amount) || amount <= 0) return null
  return {
    id: String(raw.id || '').trim() || createId('v'),
    accountId,
    type,
    amount,
    note: String(raw.note || '').trim(),
    date: String(raw.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
  }
}

function normalizeNotebook(data) {
  const categories = (Array.isArray(data?.categories) ? data.categories : [])
    .map(normalizeCategory)
    .filter(Boolean)

  const accounts = (Array.isArray(data?.accounts) ? data.accounts : [])
    .map(normalizeAccount)
    .filter(Boolean)

  const vouchers = (Array.isArray(data?.vouchers) ? data.vouchers : [])
    .map(normalizeVoucher)
    .filter(Boolean)

  return {
    version: 1,
    categories: categories.length ? categories : [...DEFAULT_NOTEBOOK.categories],
    accounts,
    vouchers,
  }
}

function parsePayload(raw) {
  if (!raw) return { ...DEFAULT_NOTEBOOK, categories: [...DEFAULT_NOTEBOOK.categories] }
  if (typeof raw === 'object') return normalizeNotebook(raw)
  try {
    return normalizeNotebook(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_NOTEBOOK, categories: [...DEFAULT_NOTEBOOK.categories] }
  }
}

function mapRow(row) {
  return {
    agentId: row.agent_id,
    payload: parsePayload(row.payload),
    updatedAt: row.updated_at,
  }
}

export async function getAgentNotebook(agentId) {
  const { rows } = await query(
    'SELECT agent_id, payload, updated_at FROM agent_notebook_data WHERE agent_id = $1',
    [agentId]
  )
  if (!rows[0]) {
    return {
      agentId,
      payload: { ...DEFAULT_NOTEBOOK, categories: [...DEFAULT_NOTEBOOK.categories] },
      updatedAt: null,
      exists: false,
    }
  }
  return { ...mapRow(rows[0]), exists: true }
}

export async function saveAgentNotebook(agentId, payload) {
  const normalized = normalizeNotebook(payload)
  const json = JSON.stringify(normalized)

  const { rows: existing } = await query(
    'SELECT agent_id FROM agent_notebook_data WHERE agent_id = $1',
    [agentId]
  )

  if (existing[0]) {
    await query(
      'UPDATE agent_notebook_data SET payload = $1, updated_at = CURRENT_TIMESTAMP WHERE agent_id = $2',
      [json, agentId]
    )
  } else {
    await query(
      'INSERT INTO agent_notebook_data (agent_id, payload) VALUES ($1, $2)',
      [agentId, json]
    )
  }

  return getAgentNotebook(agentId)
}

export async function syncAgentNotebook(agentId, { localPayload, localUpdatedAt } = {}) {
  const remote = await getAgentNotebook(agentId)
  const localTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : 0
  const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0

  if (!remote.exists && localPayload) {
    const saved = await saveAgentNotebook(agentId, localPayload)
    return { payload: saved.payload, updatedAt: saved.updatedAt, source: 'uploaded' }
  }

  if (localPayload && localTime > remoteTime) {
    const saved = await saveAgentNotebook(agentId, localPayload)
    return { payload: saved.payload, updatedAt: saved.updatedAt, source: 'local' }
  }

  return { payload: remote.payload, updatedAt: remote.updatedAt, source: 'server' }
}

export async function restoreAgentNotebook(agentId) {
  const remote = await getAgentNotebook(agentId)
  if (!remote.exists) {
    const saved = await saveAgentNotebook(agentId, DEFAULT_NOTEBOOK)
    return { payload: saved.payload, updatedAt: saved.updatedAt, restored: true, created: true }
  }
  return { payload: remote.payload, updatedAt: remote.updatedAt, restored: true, created: false }
}
