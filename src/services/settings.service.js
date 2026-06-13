import { query } from '../db/pool.js'
import { normalizeRouterSource, routerSourceLabelAr } from '../constants/routerSource.js'

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

function mapCategoryRow(row) {
  const routerSource = normalizeRouterSource(row.router_source)
  return {
    ...row,
    price: Number(row.price),
    routerSource,
    routerSourceLabel: routerSourceLabelAr(routerSource),
  }
}

export async function getCategories() {
  const { rows } = await query(
    `SELECT id, name, price, duration, data_quota AS dataQuota,
            router_profile AS routerProfile, router_source AS routerSource
     FROM categories ORDER BY id`
  )
  return rows.map(mapCategoryRow)
}

export async function createCategory({ name, price, duration, dataQuota, routerProfile, routerSource }) {
  const source = normalizeRouterSource(routerSource)
  const { insertId } = await query(
    `INSERT INTO categories (name, price, duration, data_quota, router_profile, router_source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, price, duration, dataQuota || '1 جيجا', routerProfile || null, source]
  )
  const { rows } = await query(
    `SELECT id, name, price, duration, data_quota AS dataQuota,
            router_profile AS routerProfile, router_source AS routerSource
     FROM categories WHERE id = $1`,
    [insertId]
  )
  return rows[0] ? mapCategoryRow(rows[0]) : null
}

export async function updateCategory(id, { name, price, duration, dataQuota, routerProfile, routerSource }) {
  const { rows: existing } = await query(
    'SELECT router_profile, router_source FROM categories WHERE id = $1',
    [id]
  )
  const profile = routerProfile !== undefined ? routerProfile : existing[0]?.router_profile
  const source = routerSource !== undefined
    ? normalizeRouterSource(routerSource)
    : normalizeRouterSource(existing[0]?.router_source)

  await query(
    `UPDATE categories
     SET name = $1, price = $2, duration = $3, data_quota = $4, router_profile = $5, router_source = $6
     WHERE id = $7`,
    [name, price, duration, dataQuota || '1 جيجا', profile || null, source, id]
  )
  const { rows } = await query(
    `SELECT id, name, price, duration, data_quota AS dataQuota,
            router_profile AS routerProfile, router_source AS routerSource
     FROM categories WHERE id = $1`,
    [id]
  )
  return rows[0] ? mapCategoryRow(rows[0]) : null
}

export async function deleteCategory(id) {
  await query('DELETE FROM categories WHERE id = $1', [id])
}
