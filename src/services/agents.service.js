import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { generateStrongPassword } from '../utils/password.js'

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

function mapAgent(row, devices = []) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address || '',
    balance: Number(row.balance),
    status: row.status,
    cardsSold: row.cardsSold ?? row.cards_sold ?? 0,
    devices,
  }
}

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
  const { rows } = await query(
    'SELECT id, name, phone, address, balance, status, cards_sold AS cardsSold FROM agents WHERE id = $1',
    [id]
  )
  return rows[0] || null
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
  const { rows } = await query(
    'SELECT id, name, phone, address, balance, status, cards_sold AS cardsSold FROM agents ORDER BY id'
  )
  const agents = []
  for (const row of rows) {
    const devices = await getDevicesForAgent(row.id)
    agents.push(mapAgent(row, devices))
  }
  return agents
}

export async function createAgent({ name, phone, address, password, devices }) {
  const normalizedDevices = normalizeDevices(devices)
  if (normalizedDevices.length === 0) {
    throw new Error('يجب إضافة جهاز واحد على الأقل')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const { insertId } = await query(
    `INSERT INTO agents (name, phone, address, password_hash, balance, status, cards_sold)
     VALUES ($1, $2, $3, $4, 0, 'نشط', 0)`,
    [name, phone || null, address || null, passwordHash]
  )
  await syncAgentDevices(insertId, normalizedDevices)
  const row = await findAgentRow(insertId)
  const agentDevices = await getDevicesForAgent(insertId)
  return row ? mapAgent(row, agentDevices) : null
}

export async function updateAgent(id, { name, phone, address, devices }) {
  const normalizedDevices = normalizeDevices(devices)
  if (normalizedDevices.length === 0) {
    throw new Error('يجب إضافة جهاز واحد على الأقل')
  }

  await query(
    'UPDATE agents SET name = $1, phone = $2, address = $3 WHERE id = $4',
    [name, phone || null, address || null, id]
  )
  await syncAgentDevices(id, normalizedDevices)
  const row = await findAgentRow(id)
  const agentDevices = await getDevicesForAgent(id)
  return row ? mapAgent(row, agentDevices) : null
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
  return row ? mapAgent(row, devices) : null
}

export function toPublicAgent(row, devices = []) {
  return mapAgent(row, devices)
}
