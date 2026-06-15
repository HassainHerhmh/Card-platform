import { query } from '../db/pool.js'
import { formatDate } from '../utils/format.js'
import { syncAgentPendingCardsWithRouter } from './mikrotik.service.js'
import { ROUTER_SOURCE } from '../constants/routerSource.js'

const AGENT_APP_ROUTER_SOURCE = ROUTER_SOURCE.USER_MANAGER

export async function getNetworks() {
  const { rows } = await query(
    'SELECT id, name, ip, cards_printed AS cardsPrinted FROM mikrotik_routers ORDER BY id'
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ip: row.ip,
    cardsPrinted: Number(row.cardsPrinted) || 0,
  }))
}

export async function getNetworkById(id) {
  const { rows } = await query(
    'SELECT id, name, ip, cards_printed AS cardsPrinted FROM mikrotik_routers WHERE id = $1',
    [id]
  )
  if (!rows[0]) return null
  return {
    id: rows[0].id,
    name: rows[0].name,
    ip: rows[0].ip,
    cardsPrinted: Number(rows[0].cardsPrinted) || 0,
  }
}

export async function getCategoriesForAgent(agentId) {
  syncAgentPendingCardsWithRouter(agentId).catch((error) => {
    console.warn('[agent-app] router card sync skipped:', error.message)
  })

  const { rows } = await query(
    `SELECT c.id, c.name, c.price, c.duration, c.data_quota AS dataQuota,
            COUNT(CASE WHEN ca.status = 'معلق' THEN 1 END) AS availableCards
     FROM categories c
     LEFT JOIN batches b ON b.category_id = c.id
       AND b.agent_id = $1
       AND b.router_source = $2
     LEFT JOIN cards ca ON ca.batch_id = b.id
     WHERE c.router_source = $2
       AND c.router_profile IS NOT NULL
       AND c.router_profile NOT IN (
         SELECT DISTINCT hs.router_profile
         FROM categories hs
         LEFT JOIN categories um ON um.router_profile = hs.router_profile
           AND um.router_source = 'user-manager'
         WHERE hs.router_source = 'hotspot'
           AND hs.router_profile IS NOT NULL
           AND um.id IS NULL
       )
     GROUP BY c.id, c.name, c.price, c.duration, c.data_quota, c.router_profile
     ORDER BY c.id`,
    [agentId, AGENT_APP_ROUTER_SOURCE]
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    duration: row.duration,
    dataQuota: row.dataQuota || '1 جيجا',
    availableCards: Number(row.availableCards) || 0,
  }))
}

export async function getAgentProfile(agentId) {
  const { rows } = await query(
    'SELECT id, name, phone, address, balance, status, cards_sold AS cardsSold FROM agents WHERE id = $1',
    [agentId]
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address || '',
    balance: Number(row.balance),
    status: row.status,
    cardsSold: row.cardsSold ?? 0,
  }
}

function extractCardCode(description) {
  if (!description) return null
  const match = String(description).match(/كود\s+(\S+)/)
  return match ? match[1] : null
}

function toIsoTimestamp(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function resolveOccurredAt(row) {
  return toIsoTimestamp(row.smsCreatedAt || row.createdAt)
}

export async function getAgentTransactions(agentId, limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const { rows } = await query(
    `SELECT l.id, l.\`date\`, l.\`type\`, l.cards, l.amount, l.balance, l.description, l.reference_id,
            l.created_at AS createdAt,
            (SELECT code FROM cards WHERE batch_id = l.reference_id ORDER BY id LIMIT 1) AS batchSampleCode,
            (SELECT sq.status FROM sms_queue sq
             WHERE sq.agent_id = l.agent_id
               AND l.\`type\` = 'بيع'
               AND l.description LIKE CONCAT('%كود ', SUBSTRING_INDEX(l.description, 'كود ', -1), '%')
             ORDER BY sq.id DESC LIMIT 1) AS smsStatus,
            (SELECT sq.created_at FROM sms_queue sq
             INNER JOIN cards c ON c.id = sq.card_id
             WHERE sq.agent_id = l.agent_id
               AND l.\`type\` = 'بيع'
               AND l.description LIKE CONCAT('%كود ', c.code)
             ORDER BY sq.id DESC LIMIT 1) AS smsCreatedAt
     FROM ledger l
     WHERE l.agent_id = $1
     ORDER BY l.\`date\` DESC, l.id DESC
     LIMIT ${safeLimit}`,
    [agentId]
  )

  return rows.map((row) => {
    const amount = Number(row.amount)
    const isSale = row.type === 'بيع'
    const cardCode = extractCardCode(row.description) || row.batchSampleCode || null

    let statusType = 'pending'
    let status = '—'
    let statusNote = ''

    if (isSale) {
      if (row.smsStatus === 'pending') {
        statusType = 'pending'
        status = 'جاري الانتظار'
        statusNote = 'تم ارسال SMS'
      } else if (row.smsStatus === 'failed') {
        statusType = 'failed'
        status = 'فشل'
        statusNote = 'لم تُرسل الرسالة'
      } else {
        statusType = 'done'
        status = 'مكتمل'
        statusNote = 'تم التأكيد'
      }
    } else if (row.type === 'تسليم كروت') {
      statusType = 'delivery'
      status = 'تسليم'
      statusNote = 'دفعة كروت'
    }

    return {
      id: row.id,
      type: isSale ? 'شحن كرت' : row.type,
      cardNumber: cardCode,
      amount: Math.abs(amount),
      date: formatDate(row.date),
      occurredAt: resolveOccurredAt(row),
      status,
      statusNote,
      statusType,
    }
  })
}
