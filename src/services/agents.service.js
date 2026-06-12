import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { generateStrongPassword } from '../utils/password.js'

function mapAgent(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address || '',
    balance: Number(row.balance),
    status: row.status,
    cardsSold: row.cardsSold ?? row.cards_sold ?? 0,
  }
}

async function findAgentRow(id) {
  const { rows } = await query(
    'SELECT id, name, phone, address, balance, status, cards_sold AS cardsSold FROM agents WHERE id = $1',
    [id]
  )
  return rows[0] || null
}

export async function getAgents() {
  const { rows } = await query(
    'SELECT id, name, phone, address, balance, status, cards_sold AS cardsSold FROM agents ORDER BY id'
  )
  return rows.map(mapAgent)
}

export async function createAgent({ name, phone, address, password }) {
  const passwordHash = await bcrypt.hash(password, 10)
  const { insertId } = await query(
    `INSERT INTO agents (name, phone, address, password_hash, balance, status, cards_sold)
     VALUES ($1, $2, $3, $4, 0, 'نشط', 0)`,
    [name, phone || null, address || null, passwordHash]
  )
  const row = await findAgentRow(insertId)
  return row ? mapAgent(row) : null
}

export async function updateAgent(id, { name, phone, address }) {
  await query(
    'UPDATE agents SET name = $1, phone = $2, address = $3 WHERE id = $4',
    [name, phone || null, address || null, id]
  )
  const row = await findAgentRow(id)
  return row ? mapAgent(row) : null
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
  return row ? mapAgent(row) : null
}
