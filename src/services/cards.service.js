import { query } from '../db/pool.js'
import { recordBatchDelivery } from './ledger.service.js'
import { formatDate } from '../utils/format.js'
import { buildCardCredentials, CARD_FORMAT } from '../utils/cardCode.js'
import { getCardSettings } from './settings.service.js'
import { pushRouterUsers } from './mikrotik.service.js'
import {
  routerSourceLabelAr,
  normalizeRouterSource,
} from '../constants/routerSource.js'

async function getBatchCards(batchId) {
  const { rows } = await query(
    'SELECT id, code, status FROM cards WHERE batch_id = $1 ORDER BY id',
    [batchId]
  )
  return rows
}

export async function getBatches() {
  const { rows } = await query('SELECT * FROM batches ORDER BY id DESC')
  const batches = []
  for (const row of rows) {
    batches.push({
      id: row.id,
      category: row.category_name,
      agent: row.agent_name,
      count: row.count,
      printedAt: formatDate(row.printed_at),
      routerSource: normalizeRouterSource(row.router_source),
      routerSourceLabel: routerSourceLabelAr(row.router_source),
      cards: await getBatchCards(row.id),
    })
  }
  return batches
}

export async function createBatch({
  categoryId,
  count,
  agentId,
  cardPrefix = '',
  cardSuffix = '',
  cardFormat = CARD_FORMAT.EMPTY_PASSWORD,
}) {
  const printCount = Number(count)
  if (!printCount || printCount < 1) throw new Error('عدد الكروت مطلوب')
  if (printCount > 500) throw new Error('الحد الأقصى 500 كرت في المرة الواحدة')

  const { rows: catRows } = await query(
    'SELECT * FROM categories WHERE id = $1',
    [categoryId]
  )
  const category = catRows[0]
  if (!category) throw new Error('الفئة غير موجودة')

  const profileName = category.router_profile
  if (!profileName) {
    throw new Error('الفئة غير مرتبطة ببروفايل الراوتر — نفّذ مزامنة من إعدادات الكرت أولاً')
  }

  let agentName = '-'
  let agentDbId = null
  if (agentId) {
    const { rows: agentRows } = await query('SELECT * FROM agents WHERE id = $1', [agentId])
    if (agentRows[0]) {
      agentName = agentRows[0].name
      agentDbId = agentRows[0].id
    }
  }

  const settings = await getCardSettings()
  const status = agentName !== '-' ? 'معلق' : 'مطبوع'

  const entries = Array.from({ length: printCount }, () => buildCardCredentials({
    prefix: String(cardPrefix || '').trim(),
    suffix: String(cardSuffix || '').trim(),
    format: cardFormat,
    digits: settings.digits,
    chars: settings.chars,
  }))

  const routerSource = normalizeRouterSource(category.router_source)

  const { insertId: batchId } = await query(
    `INSERT INTO batches (category_id, category_name, agent_id, agent_name, \`count\`, printed_at, router_source)
     VALUES ($1, $2, $3, $4, $5, CURDATE(), $6)`,
    [category.id, category.name, agentDbId, agentName, printCount, routerSource]
  )

  const chunkSize = 100
  try {
    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize)
      const placeholders = chunk.map(() => '(?, ?, ?)').join(', ')
      const params = chunk.flatMap((entry) => [batchId, entry.username, status])
      await query(
        `INSERT INTO cards (batch_id, code, status) VALUES ${placeholders}`,
        params
      )
    }

    await pushRouterUsers({ source: routerSource, profile: profileName, entries })
  } catch (error) {
    await query('DELETE FROM cards WHERE batch_id = $1', [batchId])
    await query('DELETE FROM batches WHERE id = $1', [batchId])
    throw error
  }

  if (agentDbId) {
    await recordBatchDelivery({
      agentId: agentDbId,
      batchId,
      categoryName: category.name,
      count: printCount,
      unitPrice: category.price,
    })
  }

  const { rows: batchRows } = await query('SELECT * FROM batches WHERE id = $1', [batchId])
  const batch = batchRows[0]
  const cards = await getBatchCards(batchId)

  return {
    id: batch.id,
    category: batch.category_name,
    agent: batch.agent_name,
    count: batch.count,
    printedAt: formatDate(batch.printed_at),
    cards,
    routerProfile: profileName,
    routerSource,
    routerSourceLabel: routerSourceLabelAr(routerSource),
  }
}
