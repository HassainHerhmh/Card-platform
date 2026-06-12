import { query } from '../db/pool.js'

export async function getCardSettings() {
  const { rows } = await query('SELECT digits, chars FROM card_settings WHERE id = 1')
  return rows[0] || { digits: 8, chars: 12 }
}

export async function updateCardSettings({ digits, chars }) {
  await query(
    `INSERT INTO card_settings (id, digits, chars) VALUES (1, $1, $2)
     ON DUPLICATE KEY UPDATE digits = VALUES(digits), chars = VALUES(chars)`,
    [digits, chars]
  )
  const { rows } = await query('SELECT digits, chars FROM card_settings WHERE id = 1')
  return rows[0]
}

export async function getCategories() {
  const { rows } = await query('SELECT id, name, price, duration FROM categories ORDER BY id')
  return rows.map((row) => ({ ...row, price: Number(row.price) }))
}

export async function createCategory({ name, price, duration }) {
  const { insertId } = await query(
    'INSERT INTO categories (name, price, duration) VALUES ($1, $2, $3)',
    [name, price, duration]
  )
  const { rows } = await query('SELECT id, name, price, duration FROM categories WHERE id = $1', [insertId])
  const row = rows[0]
  return row ? { ...row, price: Number(row.price) } : null
}

export async function updateCategory(id, { name, price, duration }) {
  await query(
    'UPDATE categories SET name = $1, price = $2, duration = $3 WHERE id = $4',
    [name, price, duration, id]
  )
  const { rows } = await query('SELECT id, name, price, duration FROM categories WHERE id = $1', [id])
  const row = rows[0]
  return row ? { ...row, price: Number(row.price) } : null
}

export async function deleteCategory(id) {
  await query('DELETE FROM categories WHERE id = $1', [id])
}
