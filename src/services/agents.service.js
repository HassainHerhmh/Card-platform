import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { generateStrongPassword } from '../utils/password.js'
import {
  getAccountsBalances,
  validateSubAccount,
} from './accounting.service.js'

function normalizeDevices(devices = []) {
  const seen = new Set()
  const normalized = []
  for (const item of devices) {
    const deviceId = String(item?.deviceId || item?.device_id || '').trim()
    if (!deviceId || seen.has(deviceId)) continue
    seen.add(deviceId)
    normalized.push({
      deviceId,
      label: String(item?.label || '').trim(),
    })
  }
  return normalized
}

function mapAgent(row, devices = [], accountBalance = null) {
  const linkedAccountId = row.account_id || row.accountId || null
  const balance = linkedAccountId != null
    ? (accountBalance ?? 0)
    : Number(row.balance)

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address || '',
    accountId: linkedAccountId,
    accountName: row.account_name || row.accountName || '',
    accountCode: row.account_code || row.accountCode || '',
    balance,
    balanceSource: linkedAccountId != null ? 'account' : 'legacy',
    status: row.status,
    cardsSold: row.cardsSold ?? row.cards_sold ?? 0,
    devices,
  }
}

const AGENT_SELECT = `
  SELECT a.id, a.name, a.phone, a.address, a.balance, a.status, a.cards_sold AS cardsSold,
         a.account_id, aa.code AS account_code, aa.name_ar AS account_name
  FROM agents a
  LEFT JOIN accounting_accounts aa ON aa.id = a.account_id
`

async function getDevicesForAgent(agentId) {
  const { rows } = await query(
    'SELECT id, device_id AS deviceId, label FROM agent_devices WHERE agent_id = $1 ORDER BY id',
    [agentId]
  )
  return rows
}

async function syncAgentDevices(agentId, devices) {
  await query('DELETE FROM agent_devices WHERE agent_id = $1', [agentId])
  for (const device of normalizeDevices(devices)) {
    await query(
      'INSERT INTO agent_devices (agent_id, device_id, label) VALUES ($1, $2, $3)',
      [agentId, device.deviceId, device.label || null]
    )
  }
}

async function findAgentRow(id) {
  const { rows } = await query(`${AGENT_SELECT} WHERE a.id = $1`, [id])
  return rows[0] || null
}

async function mapAgentWithBalance(row, devices) {
  const balances = row.account_id
    ? await getAccountsBalances([row.account_id])
    : {}
  return mapAgent(row, devices, balances[row.account_id])
}

export async function findByPhone(phone) {
  const { rows } = await query('SELECT * FROM agents WHERE phone = $1', [phone])
  return rows[0] || null
}

export async function verifyPassword(agent, password) {
  if (!agent?.password_hash) return false
  return bcrypt.compare(password, agent.password_hash)
}

export async function getAgentDevices(agentId) {
  return getDevicesForAgent(agentId)
}

export async function isDeviceAllowed(agentId, deviceId) {
  const { rows } = await query(
    'SELECT id FROM agent_devices WHERE agent_id = $1 AND device_id = $2',
    [agentId, deviceId]
  )
  return rows.length > 0
}

export async function getAgents() {
  const { rows } = await query(`${AGENT_SELECT} ORDER BY a.id`)
  const accountIds = rows.map((row) => row.account_id).filter(Boolean)
  const balances = await getAccountsBalances(accountIds)
  const agents = []

  for (const row of rows) {
    const devices = await getDevicesForAgent(row.id)
    agents.push(mapAgent(row, devices, row.account_id ? balances[row.account_id] : null))
  }

  return agents
}

export async function createAgent({ name, phone, address, password, devices, accountId }) {
  const normalizedDevices = normalizeDevices(devices)
  if (normalizedDevices.length === 0) {
    throw new Error('يجب إضافة جهاز واحد على الأقل')
  }

  if (!accountId) {
    throw new Error('الحساب المحاسبي مطلوب')
  }

  await validateSubAccount(accountId)

  const passwordHash = await bcrypt.hash(password, 10)
  const { insertId } = await query(
    `INSERT INTO agents (name, phone, address, password_hash, balance, status, cards_sold, account_id)
     VALUES ($1, $2, $3, $4, 0, 'نشط', 0, $5)`,
    [name, phone || null, address || null, passwordHash, accountId]
  )
  await syncAgentDevices(insertId, normalizedDevices)
  const row = await findAgentRow(insertId)
  const agentDevices = await getDevicesForAgent(insertId)
  return row ? mapAgentWithBalance(row, agentDevices) : null
}

export async function updateAgent(id, { name, phone, address, devices, accountId }) {
  const normalizedDevices = normalizeDevices(devices)
  if (normalizedDevices.length === 0) {
    throw new Error('يجب إضافة جهاز واحد على الأقل')
  }

  if (!accountId) {
    throw new Error('الحساب المحاسبي مطلوب')
  }

  await validateSubAccount(accountId)

  await query(
    'UPDATE agents SET name = $1, phone = $2, address = $3, account_id = $4 WHERE id = $5',
    [name, phone || null, address || null, accountId, id]
  )
  await syncAgentDevices(id, normalizedDevices)
  const row = await findAgentRow(id)
  const agentDevices = await getDevicesForAgent(id)
  return row ? mapAgentWithBalance(row, agentDevices) : null
}

async function updatePassword(id, password) {
  const passwordHash = await bcrypt.hash(password, 10)
  await query('UPDATE agents SET password_hash = $1 WHERE id = $2', [passwordHash, id])
}

export async function resetAgentPassword(id) {
  const password = generateStrongPassword(9)
  await updatePassword(id, password)
  return password
}

export async function toggleAgentStatus(id) {
  await query(
    `UPDATE agents SET status = CASE WHEN status = 'نشط' THEN 'موقوف' ELSE 'نشط' END
     WHERE id = $1`,
    [id]
  )
  const row = await findAgentRow(id)
  const devices = await getDevicesForAgent(id)
  return row ? mapAgentWithBalance(row, devices) : null
}

export function toPublicAgent(row, devices = []) {
  return mapAgent(row, devices)
}
