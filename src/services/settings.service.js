import { query } from '../db/pool.js'
import { normalizeRouterSource, routerSourceLabelAr } from '../constants/routerSource.js'
import { formatDurationLabel, normalizeDurationInput } from '../utils/duration.js'

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
  const routerSource = normalizeRouterSource(row.routerSource ?? row.router_source)
  const durationHours = Number(row.durationHours ?? row.duration_hours ?? 24)
  const durationMinutes = Number(row.durationMinutes ?? row.duration_minutes ?? 0)
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    durationHours,
    durationMinutes,
    duration: row.duration || formatDurationLabel(durationHours, durationMinutes),
    dataQuota: row.dataQuota ?? row.data_quota ?? '1 جيجا',
    routerProfile: row.routerProfile ?? row.router_profile ?? null,
    routerSource,
    routerSourceLabel: routerSourceLabelAr(routerSource),
  }
}

export async function getCategories() {
  const { rows } = await query(
    `SELECT id, name, price, duration, duration_hours AS durationHours,
            duration_minutes AS durationMinutes, data_quota AS dataQuota,
            router_profile AS routerProfile, router_source AS routerSource
     FROM categories ORDER BY id`
  )
  return rows.map(mapCategoryRow)
}

export async function createCategory({
  name, price, duration, durationHours, durationMinutes, dataQuota, routerProfile, routerSource,
}) {
  const source = normalizeRouterSource(routerSource)
  const normalized = normalizeDurationInput(durationHours, durationMinutes)
  const { insertId } = await query(
    `INSERT INTO categories
      (name, price, duration, duration_hours, duration_minutes, data_quota, router_profile, router_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      name, price, duration || normalized.duration, normalized.durationHours,
      normalized.durationMinutes, dataQuota || '1 جيجا', routerProfile || null, source,
    ]
  )
  const { rows } = await query(
    `SELECT id, name, price, duration, duration_hours AS durationHours,
            duration_minutes AS durationMinutes, data_quota AS dataQuota,
            router_profile AS routerProfile, router_source AS routerSource
     FROM categories WHERE id = $1`,
    [insertId]
  )
  return rows[0] ? mapCategoryRow(rows[0]) : null
}

export async function updateCategory(id, {
  name, price, duration, durationHours, durationMinutes, dataQuota, routerProfile, routerSource,
}) {
  const { rows: existing } = await query(
    'SELECT router_profile, router_source, duration_hours, duration_minutes FROM categories WHERE id = $1',
    [id]
  )
  const profile = routerProfile !== undefined ? routerProfile : existing[0]?.router_profile
  const source = routerSource !== undefined
    ? normalizeRouterSource(routerSource)
    : normalizeRouterSource(existing[0]?.router_source)

  const normalized = normalizeDurationInput(
    durationHours ?? existing[0]?.duration_hours,
    durationMinutes ?? existing[0]?.duration_minutes
  )

  await query(
    `UPDATE categories
     SET name = $1, price = $2, duration = $3, duration_hours = $4, duration_minutes = $5,
         data_quota = $6, router_profile = $7, router_source = $8
     WHERE id = $9`,
    [
      name, price, duration || normalized.duration, normalized.durationHours,
      normalized.durationMinutes, dataQuota || '1 جيجا', profile || null, source, id,
    ]
  )
  const { rows } = await query(
    `SELECT id, name, price, duration, duration_hours AS durationHours,
            duration_minutes AS durationMinutes, data_quota AS dataQuota,
            router_profile AS routerProfile, router_source AS routerSource
     FROM categories WHERE id = $1`,
    [id]
  )
  return rows[0] ? mapCategoryRow(rows[0]) : null
}

export async function deleteCategory(id) {
  await query('DELETE FROM categories WHERE id = $1', [id])
}
