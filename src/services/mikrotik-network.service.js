import { query } from '../db/pool.js'

const LOGO_MAX_CHARS = 2_000_000

function mapNetworkRow(row, extras = {}) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName || row.display_name || row.name,
    logoUrl: row.logoUrl || row.logo_url || '',
    ip: row.ip,
    cardsPrinted: Number(row.cardsPrinted ?? row.cards_printed) || 0,
    ...extras,
  }
}

export async function getMainNetworkRow() {
  const { rows } = await query(
    `SELECT id, name, display_name AS displayName, logo_url AS logoUrl,
            ip, cards_printed AS cardsPrinted
     FROM mikrotik_routers
     ORDER BY id
     LIMIT 1`
  )
  return rows[0] || null
}

export async function getNetworkSettings() {
  const row = await getMainNetworkRow()
  return mapNetworkRow(row)
}

export async function updateNetworkSettings({ displayName, logoUrl } = {}) {
  const row = await getMainNetworkRow()
  if (!row) {
    throw new Error('لا توجد شبكة مسجّلة — أعد تشغيل قاعدة البيانات أو أضف راوتراً')
  }

  const nextDisplayName = displayName != null
    ? String(displayName).trim().slice(0, 255)
    : (row.displayName || row.name)

  if (!nextDisplayName) {
    throw new Error('اسم الشبكة مطلوب')
  }

  let nextLogoUrl = row.logoUrl || ''
  if (logoUrl !== undefined) {
    const trimmed = String(logoUrl || '').trim()
    if (trimmed && trimmed.length > LOGO_MAX_CHARS) {
      throw new Error('حجم الشعار كبير — استخدم صورة أصغر')
    }
    nextLogoUrl = trimmed
  }

  await query(
    `UPDATE mikrotik_routers
     SET display_name = $1, logo_url = $2
     WHERE id = $3`,
    [nextDisplayName, nextLogoUrl || null, row.id]
  )

  return getNetworkSettings()
}

export async function countAgentPendingCards(agentId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM cards ca
     INNER JOIN batches b ON b.id = ca.batch_id
     WHERE b.agent_id = $1 AND ca.status = 'معلق'`,
    [agentId]
  )
  return Number(rows[0]?.total) || 0
}
