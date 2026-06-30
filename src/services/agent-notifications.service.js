import { query } from '../db/pool.js'
import { formatCurrency } from '../constants/currency.js'

function buildDeliveryCopy({ categoryName, count, amount }) {
  const cards = Number(count) || 0
  const total = Number(amount) || 0
  return {
    title: 'تسليم كروت',
    body: `تم تسليم دفعة فئة ${categoryName} — ${cards.toLocaleString('ar-YE')} كرت — ${formatCurrency(total)}`,
  }
}

function mapNotificationRow(row) {
  return {
    id: row.id,
    type: row.type,
    batchId: row.batchId,
    categoryName: row.categoryName,
    cardCount: Number(row.cardCount) || 0,
    amount: Number(row.amount) || 0,
    title: row.title,
    body: row.body,
    isRead: Boolean(row.isRead),
    createdAt: row.createdAt,
  }
}

export async function createDeliveryNotification({
  agentId,
  batchId,
  categoryName,
  count,
  amount,
}) {
  if (!agentId || !batchId) return null

  const { rows: existing } = await query(
    `SELECT id, type, batch_id AS batchId, category_name AS categoryName,
            card_count AS cardCount, amount, title, body,
            is_read AS isRead, created_at AS createdAt
     FROM agent_notifications
     WHERE agent_id = $1 AND batch_id = $2 AND type = 'delivery'
     LIMIT 1`,
    [agentId, batchId]
  )
  if (existing[0]) return mapNotificationRow(existing[0])

  const copy = buildDeliveryCopy({ categoryName, count, amount: amount ?? 0 })
  const result = await query(
    `INSERT INTO agent_notifications
      (agent_id, batch_id, type, category_name, card_count, amount, title, body)
     VALUES ($1, $2, 'delivery', $3, $4, $5, $6, $7)`,
    [agentId, batchId, categoryName, count, amount ?? 0, copy.title, copy.body]
  )

  const insertId = result.insertId
  const { rows } = await query(
    `SELECT id, type, batch_id AS batchId, category_name AS categoryName,
            card_count AS cardCount, amount, title, body,
            is_read AS isRead, created_at AS createdAt
     FROM agent_notifications
     WHERE id = $1`,
    [insertId]
  )
  return rows[0] ? mapNotificationRow(rows[0]) : null
}

export async function syncMissingDeliveryNotifications(agentId, { limit = 200 } = {}) {
  if (!agentId) return 0

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500)
  const { rows } = await query(
    `SELECT b.id AS batchId, b.category_name AS categoryName, b.count,
            (b.count * COALESCE(c.price, 0)) AS amount
     FROM batches b
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.agent_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM agent_notifications n
         WHERE n.agent_id = b.agent_id AND n.batch_id = b.id AND n.type = 'delivery'
       )
     ORDER BY b.id DESC
     LIMIT ${safeLimit}`,
    [agentId]
  )

  let created = 0
  for (const row of rows) {
    await createDeliveryNotification({
      agentId,
      batchId: row.batchId,
      categoryName: row.categoryName,
      count: row.count,
      amount: row.amount,
    })
    created += 1
  }
  return created
}

export async function getAgentNotifications(agentId, { limit = 50 } = {}) {
  await syncMissingDeliveryNotifications(agentId)

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const { rows } = await query(
    `SELECT id, type, batch_id AS batchId, category_name AS categoryName,
            card_count AS cardCount, amount, title, body,
            is_read AS isRead, created_at AS createdAt
     FROM agent_notifications
     WHERE agent_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT ${safeLimit}`,
    [agentId]
  )
  return rows.map(mapNotificationRow)
}

export async function getUnreadNotificationCount(agentId) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total
     FROM agent_notifications
     WHERE agent_id = $1 AND is_read = 0`,
    [agentId]
  )
  return Number(rows[0]?.total) || 0
}

export async function markNotificationRead(agentId, notificationId) {
  await query(
    `UPDATE agent_notifications
     SET is_read = 1
     WHERE id = $1 AND agent_id = $2`,
    [notificationId, agentId]
  )
  return { ok: true }
}

export async function markAllNotificationsRead(agentId) {
  await query(
    `UPDATE agent_notifications
     SET is_read = 1
     WHERE agent_id = $1 AND is_read = 0`,
    [agentId]
  )
  return { ok: true }
}
