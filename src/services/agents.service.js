import { query } from '../db/pool.js'

export async function getAgents() {
  const { rows } = await query(
    'SELECT id, name, phone, balance, status, cards_sold AS cardsSold FROM agents ORDER BY id'
  )
  return rows.map((row) => ({ ...row, balance: Number(row.balance) }))
}

export async function createAgent({ name, phone, balance }) {
  const { insertId } = await query(
    `INSERT INTO agents (name, phone, balance, status, cards_sold)
     VALUES ($1, $2, $3, 'نشط', 0)`,
    [name, phone, balance || 0]
  )
  const { rows } = await query(
    'SELECT id, name, phone, balance, status, cards_sold AS cardsSold FROM agents WHERE id = $1',
    [insertId]
  )
  const row = rows[0]
  return row ? { ...row, balance: Number(row.balance) } : null
}
