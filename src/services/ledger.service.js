import { query } from '../db/pool.js'
import { formatDate } from '../utils/format.js'

async function getAgentRow(agentId) {
  const { rows } = await query(
    'SELECT id, name, balance, cards_sold AS cardsSold FROM agents WHERE id = $1',
    [agentId]
  )
  if (!rows[0]) throw new Error('الوكيل غير موجود')
  return rows[0]
}

function inferDebitCredit(row) {
  let debit = Number(row.debit) || 0
  let credit = Number(row.credit) || 0
  const legacyAmount = Math.abs(Number(row.amount) || 0)
  if (!debit && !credit && legacyAmount) {
    if (row.type === 'سند قبض' || row.type === 'إيداع') credit = legacyAmount
    else debit = legacyAmount
  }
  return { debit, credit, amount: legacyAmount || debit || credit }
}

function mapEntry(row) {
  const { debit, credit, amount } = inferDebitCredit(row)
  return {
    id: row.id,
    date: formatDate(row.date),
    agentId: row.agent_id,
    agent: row.agent_name,
    type: row.type,
    cards: row.cards || 0,
    debit,
    credit,
    amount,
    balance: Number(row.balance),
    description: row.description || '',
    referenceId: row.reference_id,
  }
}

export async function appendLedgerEntry({
  agentId,
  type,
  cards = 0,
  debit = 0,
  credit = 0,
  date,
  description = '',
  referenceId = null,
}) {
  const agent = await getAgentRow(agentId)
  const debitVal = Math.max(0, Number(debit) || 0)
  const creditVal = Math.max(0, Number(credit) || 0)
  if (debitVal === 0 && creditVal === 0) {
    throw new Error('المبلغ مطلوب')
  }

  const newBalance = Number(agent.balance) + creditVal - debitVal
  const entryDate = date || new Date().toISOString().slice(0, 10)
  const amount = debitVal || creditVal

  await query('UPDATE agents SET balance = $1 WHERE id = $2', [newBalance, agentId])

  const { insertId } = await query(
    `INSERT INTO ledger
     (\`date\`, agent_id, agent_name, \`type\`, cards, amount, balance, debit, credit, description, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      entryDate,
      agentId,
      agent.name,
      type,
      cards,
      amount,
      newBalance,
      debitVal,
      creditVal,
      String(description || '').slice(0, 500),
      referenceId,
    ]
  )

  return { id: insertId, balance: newBalance }
}

export async function recordBatchDelivery({ agentId, batchId, categoryName, count, unitPrice }) {
  const total = Number(count) * Number(unitPrice)
  return appendLedgerEntry({
    agentId,
    type: 'تسليم كروت',
    cards: count,
    debit: total,
    description: `تسليم ${count} كرت — ${categoryName} — ${total.toLocaleString('ar-SA')} ر.س`,
    referenceId: batchId,
  })
}

export async function recordCardSale({ agentId, agentName, price, categoryName, cardCode, networkName }) {
  const agent = await getAgentRow(agentId)
  const debitVal = Number(price)
  const newBalance = Number(agent.balance) - debitVal
  const cardsSold = (agent.cardsSold ?? 0) + 1

  await query(
    'UPDATE agents SET balance = $1, cards_sold = $2 WHERE id = $3',
    [newBalance, cardsSold, agentId]
  )

  const description = `بيع كرت — ${categoryName}${networkName ? ` — ${networkName}` : ''} — كود ${cardCode}`

  const { insertId } = await query(
    `INSERT INTO ledger
     (\`date\`, agent_id, agent_name, \`type\`, cards, amount, balance, debit, credit, description)
     VALUES (CURDATE(), $1, $2, 'بيع', 1, $3, $4, $5, 0, $6)`,
    [agentId, agentName, debitVal, newBalance, debitVal, description]
  )

  return { id: insertId, balance: newBalance }
}

export async function createReceiptVoucher({ agentId, amount, date, notes }) {
  const value = Number(amount)
  if (!value || value <= 0) throw new Error('المبلغ غير صالح')

  return appendLedgerEntry({
    agentId,
    type: 'سند قبض',
    credit: value,
    date,
    description: notes?.trim() || `سند قبض — ${value.toLocaleString('ar-SA')} ر.س`,
  })
}

export async function createPaymentVoucher({ agentId, amount, date, notes }) {
  const value = Number(amount)
  if (!value || value <= 0) throw new Error('المبلغ غير صالح')

  const agent = await getAgentRow(agentId)
  if (Number(agent.balance) < value) {
    throw new Error('رصيد الوكيل غير كافٍ للصرف')
  }

  return appendLedgerEntry({
    agentId,
    type: 'سند صرف',
    debit: value,
    date,
    description: notes?.trim() || `سند صرف — ${value.toLocaleString('ar-SA')} ر.س`,
  })
}

export async function getAccountStatement({ agentId, fromDate, toDate }) {
  if (!agentId) throw new Error('الوكيل مطلوب')

  const agent = await getAgentRow(agentId)
  const params = [agentId]
  let dateFilter = ''

  if (fromDate) {
    dateFilter += ' AND `date` >= $2'
    params.push(fromDate)
  }
  if (toDate) {
    dateFilter += ` AND \`date\` <= $${params.length + 1}`
    params.push(toDate)
  }

  const { rows } = await query(
    `SELECT id, \`date\`, agent_id, agent_name, \`type\`, cards, amount, balance,
            debit, credit, description, reference_id
     FROM ledger
     WHERE agent_id = $1${dateFilter}
     ORDER BY \`date\` ASC, id ASC`,
    params
  )

  const entries = rows.map(mapEntry)
  const totals = entries.reduce(
    (acc, row) => ({
      debit: acc.debit + row.debit,
      credit: acc.credit + row.credit,
      cards: acc.cards + (row.cards || 0),
    }),
    { debit: 0, credit: 0, cards: 0 }
  )

  return {
    agent: { id: agent.id, name: agent.name, balance: Number(agent.balance) },
    entries,
    totals,
    period: { from: fromDate || null, to: toDate || null },
  }
}

export async function getRecentVouchers(type, limit = 20) {
  const { rows } = await query(
    `SELECT id, \`date\`, agent_name, \`type\`, debit, credit, amount, balance, description
     FROM ledger
     WHERE \`type\` = $1
     ORDER BY id DESC
     LIMIT ${Math.min(Math.max(Number(limit) || 20, 1), 100)}`,
    [type]
  )
  return rows.map(mapEntry)
}
