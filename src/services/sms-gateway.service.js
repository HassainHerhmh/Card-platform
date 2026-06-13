import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { recordCardSale } from './ledger.service.js'

const GATEWAY_ONLINE_SECONDS = 30
const SMS_SERVICE_UNAVAILABLE =
  'توجد مشكلة في الخدمة حالياً، لم يُنفّذ الطلب'

function normalizeRecipientPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('00967')) digits = digits.slice(2)
  if (digits.startsWith('967') && digits.length >= 12) return digits
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length === 9) return `967${digits}`
  return digits
}

function buildSmsMessage({ categoryName, cardCode, duration, dataQuota, networkName }) {
  return [
    'شحن فوري',
    `الشبكة: ${networkName}`,
    `الباقة: ${categoryName}`,
    `كود الكرت: ${cardCode}`,
    `التحميل: ${dataQuota}`,
    `الصلاحية: ${duration}`,
  ].join('\n')
}

export async function reserveCardForAgent(agentId, categoryId) {
  const { rows } = await query(
    `SELECT ca.id AS cardId, ca.code AS cardCode,
            c.id AS categoryId, c.name AS categoryName, c.price, c.duration,
            c.data_quota AS dataQuota
     FROM cards ca
     INNER JOIN batches b ON b.id = ca.batch_id
     INNER JOIN categories c ON c.id = b.category_id
     WHERE b.agent_id = $1 AND c.id = $2 AND ca.status = 'معلق'
     ORDER BY ca.id ASC
     LIMIT 1`,
    [agentId, categoryId]
  )
  return rows[0] || null
}

export async function touchGatewayHeartbeat() {
  await query(
    `INSERT INTO sms_gateway_heartbeat (id, last_seen_at) VALUES (1, NOW())
     ON DUPLICATE KEY UPDATE last_seen_at = NOW()`
  )
}

export async function isSmsGatewayOnline() {
  if (!env.smsGatewayToken) return false
  const { rows } = await query(
    'SELECT last_seen_at AS lastSeenAt FROM sms_gateway_heartbeat WHERE id = 1'
  )
  if (!rows[0]?.lastSeenAt) return false
  const ageMs = Date.now() - new Date(rows[0].lastSeenAt).getTime()
  return ageMs <= GATEWAY_ONLINE_SECONDS * 1000
}

export async function getSmsServiceStatus() {
  const configured = Boolean(env.smsGatewayToken)
  const online = configured ? await isSmsGatewayOnline() : false
  return { configured, online, available: online }
}

export async function assertSmsGatewayAvailable() {
  if (!env.smsGatewayToken || !(await isSmsGatewayOnline())) {
    throw new Error(SMS_SERVICE_UNAVAILABLE)
  }
}

export async function processAgentCharge({
  agentId,
  categoryId,
  networkId,
  recipientPhone,
  sendSms,
}) {
  if (sendSms) {
    await assertSmsGatewayAvailable()
  }

  const phone = normalizeRecipientPhone(recipientPhone)
  if (phone.length < 11) {
    throw new Error('رقم الهاتف غير صالح')
  }

  const card = await reserveCardForAgent(agentId, categoryId)
  if (!card) {
    throw new Error('لا توجد كروت متاحة لهذه الفئة')
  }

  const { rows: agentRows } = await query(
    'SELECT id, name, balance, cards_sold AS cardsSold FROM agents WHERE id = $1',
    [agentId]
  )
  const agent = agentRows[0]
  if (!agent) throw new Error('الوكيل غير موجود')

  const price = Number(card.price)
  const balance = Number(agent.balance)
  if (balance < price) {
    throw new Error('رصيد الوكيل غير كافٍ')
  }

  let networkName = '—'
  if (networkId) {
    const { rows: netRows } = await query(
      'SELECT name FROM mikrotik_routers WHERE id = $1',
      [networkId]
    )
    if (netRows[0]) networkName = netRows[0].name
  }

  await query('UPDATE cards SET status = $1 WHERE id = $2', ['مباع', card.cardId])

  const { balance: newBalance } = await recordCardSale({
    agentId,
    agentName: agent.name,
    price,
    categoryName: card.categoryName,
    cardCode: card.cardCode,
    networkName,
  })

  let smsQueueId = null
  if (sendSms) {
    const message = buildSmsMessage({
      categoryName: card.categoryName,
      cardCode: card.cardCode,
      duration: card.duration,
      dataQuota: card.dataQuota || '1 جيجا',
      networkName,
    })
    const { insertId } = await query(
      `INSERT INTO sms_queue
       (recipient_phone, message, status, agent_id, card_id, category_name, network_name)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6)`,
      [phone, message, agentId, card.cardId, card.categoryName, networkName]
    )
    smsQueueId = insertId
  }

  return {
    cardCode: card.cardCode,
    categoryName: card.categoryName,
    price,
    balance: newBalance,
    recipientPhone: phone,
    sendSms: Boolean(sendSms),
    smsQueueId,
    smsStatus: sendSms ? 'pending' : null,
  }
}

export async function getPendingSms(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50)
  const { rows } = await query(
    `SELECT id, recipient_phone AS recipientPhone, message, category_name AS categoryName,
            network_name AS networkName, created_at AS createdAt
     FROM sms_queue
     WHERE status = 'pending'
     ORDER BY id ASC
     LIMIT ${safeLimit}`
  )
  return rows
}

export async function markSmsSent(id) {
  await query(
    `UPDATE sms_queue SET status = 'sent', sent_at = NOW(), error_message = NULL WHERE id = $1 AND status = 'pending'`,
    [id]
  )
  const { rows } = await query('SELECT id, status, sent_at AS sentAt FROM sms_queue WHERE id = $1', [id])
  return rows[0] || null
}

export async function markSmsFailed(id, errorMessage) {
  await query(
    `UPDATE sms_queue SET status = 'failed', error_message = $1 WHERE id = $2 AND status = 'pending'`,
    [String(errorMessage || 'فشل الإرسال').slice(0, 500), id]
  )
  const { rows } = await query('SELECT id, status FROM sms_queue WHERE id = $1', [id])
  return rows[0] || null
}

export async function getGatewayStats() {
  const { rows } = await query(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM sms_queue`
  )
  const stats = rows[0] || {}
  return {
    pending: Number(stats.pending) || 0,
    sent: Number(stats.sent) || 0,
    failed: Number(stats.failed) || 0,
  }
}
