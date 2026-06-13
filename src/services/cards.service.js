import { query } from '../db/pool.js'
import { recordBatchDelivery } from './ledger.service.js'
import { formatDate } from '../utils/format.js'
import { generateCardCode } from '../utils/cardCode.js'
import { getCardSettings } from './settings.service.js'

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
      cards: await getBatchCards(row.id),
    })
  }
  return batches
}

export async function createBatch({ categoryId, count, agentId }) {
  const { rows: catRows } = await query('SELECT * FROM categories WHERE id = $1', [categoryId])
  const category = catRows[0]
  if (!category) throw new Error('الفئة غير موجودة')

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

  const { insertId } = await query(
    `INSERT INTO batches (category_id, category_name, agent_id, agent_name, \`count\`, printed_at)
     VALUES ($1, $2, $3, $4, $5, CURDATE())`,
    [category.id, category.name, agentDbId, agentName, count]
  )

  const { rows: batchRows } = await query('SELECT * FROM batches WHERE id = $1', [insertId])
  const batch = batchRows[0]
  const cards = []

  for (let i = 0; i < count; i += 1) {
    const code = generateCardCode({ digits: settings.digits, chars: settings.chars })
    const { insertId: cardId } = await query(
      'INSERT INTO cards (batch_id, code, status) VALUES ($1, $2, $3)',
      [batch.id, code, status]
    )
    const { rows: cardRows } = await query('SELECT id, code, status FROM cards WHERE id = $1', [cardId])
    cards.push(cardRows[0])
  }

  if (agentDbId) {
    await recordBatchDelivery({
      agentId: agentDbId,
      batchId: batch.id,
      categoryName: category.name,
      count,
      unitPrice: category.price,
    })
  }

  return {
    id: batch.id,
    category: batch.category_name,
    agent: batch.agent_name,
    count: batch.count,
    printedAt: formatDate(batch.printed_at),
    cards,
  }
}
