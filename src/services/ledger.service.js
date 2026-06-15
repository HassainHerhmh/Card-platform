import { query } from '../db/pool.js'
import { formatDate } from '../utils/format.js'
import { formatCurrency } from '../constants/currency.js'
import {
  postCardBatchDeliveryJournal,
  hasBatchDeliveryJournal,
  getTransitAccounts,
  getLocalJournalDate,
} from './accounting.service.js'

async function getAgentRow(agentId) {
  const { rows } = await query(
    'SELECT id, name, balance, cards_sold AS cardsSold, account_id AS accountId FROM agents WHERE id = $1',
    [agentId]
  )
  if (!rows[0]) throw new Error('الوكيل غير موجود')
  const row = rows[0]
  return {
    ...row,
    accountId: row.accountId ?? row.account_id ?? null,
  }
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
     (\`date\`, agent_id, agent_name, \`type\`, cards, amount, balance, debit, credit, description, reference_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
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
  const agent = await getAgentRow(agentId)
  const description = `تسليم دفعة ${count} كرت — فئة ${categoryName} — ${formatCurrency(total)}`

  if (agent.accountId) {
    const exists = await hasBatchDeliveryJournal(batchId)
    if (!exists) {
      await postCardBatchDeliveryJournal({
        batchId,
        agentAccountId: agent.accountId,
        total,
        description,
        journalDate: await getLocalJournalDate(),
      })
    }
    return { journal: true, balance: null }
  }

  return appendLedgerEntry({
    agentId,
    type: 'تسليم كروت',
    cards: count,
    debit: total,
    description,
    referenceId: batchId,
  })
}

export async function syncMissingBatchJournals({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const { rows } = await query(
    `SELECT b.id AS batchId, b.category_name AS categoryName, b.count, b.printed_at AS printedAt,
            a.account_id AS accountId, COALESCE(c.price, 0) AS price
     FROM batches b
     INNER JOIN agents a ON a.id = b.agent_id
     LEFT JOIN categories c ON c.id = b.category_id
     WHERE b.agent_id IS NOT NULL
     ORDER BY b.id DESC
     LIMIT ${safeLimit}`
  )

  const settings = await getTransitAccounts()
  if (!settings.card_income_account && !settings.commission_income_account) {
    throw new Error('حدّد حساب وسيط إيرادات الكروت من إعدادات الحسابات الوسيطة')
  }

  const results = []
  for (const row of rows) {
    const batchId = row.batchId ?? row.id
    if (await hasBatchDeliveryJournal(batchId)) {
      results.push({ batchId, status: 'exists' })
      continue
    }

    const accountId = row.accountId ?? row.account_id
    if (!accountId) {
      results.push({ batchId, status: 'skipped', reason: 'الوكيل بلا حساب محاسبي' })
      continue
    }

    const total = Number(row.count) * Number(row.price || 0)
    if (total <= 0) {
      results.push({ batchId, status: 'skipped', reason: 'قيمة الدفعة صفر' })
      continue
    }

    const printedAt = row.printedAt
    const journalDate = printedAt instanceof Date
      ? printedAt.toISOString().slice(0, 10)
      : String(printedAt || '').slice(0, 10) || await getLocalJournalDate()

    try {
      await postCardBatchDeliveryJournal({
        batchId,
        agentAccountId: accountId,
        total,
        description: `تسليم دفعة ${row.count} كرت — فئة ${row.categoryName} — ${formatCurrency(total)}`,
        journalDate,
      })
      results.push({ batchId, status: 'created' })
    } catch (error) {
      results.push({ batchId, status: 'error', reason: error.message })
    }
  }

  return results
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
     (\`date\`, agent_id, agent_name, \`type\`, cards, amount, balance, debit, credit, description, created_at)
     VALUES (CURDATE(), $1, $2, 'بيع', 1, $3, $4, $5, 0, $6, NOW())`,
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
    description: notes?.trim() || `سند قبض — ${formatCurrency(value)}`,
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
    description: notes?.trim() || `سند صرف — ${formatCurrency(value)}`,
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

export async function listVouchers({ type, date, allDates, search, limit = 200 }) {
  const params = [type]
  let sql = `
    SELECT id, \`date\`, agent_id, agent_name, \`type\`, debit, credit, amount, balance, description
    FROM ledger
    WHERE \`type\` = $1`

  if (!allDates && date) {
    params.push(date)
    sql += ` AND \`date\` = $${params.length}`
  }

  if (search?.trim()) {
    const term = `%${search.trim()}%`
    params.push(term, term, term, term)
    const i = params.length
    sql += ` AND (
      CAST(id AS CHAR) LIKE $${i - 3}
      OR agent_name LIKE $${i - 2}
      OR description LIKE $${i - 1}
      OR CAST(amount AS CHAR) LIKE $${i}
    )`
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500)
  sql += ` ORDER BY \`date\` DESC, id DESC LIMIT ${safeLimit}`

  const { rows } = await query(sql, params)
  return rows.map(mapEntry)
}

async function getVoucherById(id) {
  const { rows } = await query(
    `SELECT id, \`date\`, agent_id, agent_name, \`type\`, debit, credit, amount, balance, description
     FROM ledger WHERE id = $1`,
    [id]
  )
  const row = rows[0]
  if (!row) throw new Error('السند غير موجود')
  if (row.type !== 'سند قبض' && row.type !== 'سند صرف') {
    throw new Error('لا يمكن تعديل هذا القيد')
  }
  return row
}

async function recalcAgentBalances(agentId) {
  const { rows } = await query(
    `SELECT id, debit, credit, amount, \`type\`
     FROM ledger WHERE agent_id = $1 ORDER BY \`date\` ASC, id ASC`,
    [agentId]
  )

  let balance = 0
  for (const row of rows) {
    const { debit, credit } = inferDebitCredit(row)
    balance += credit - debit
    await query('UPDATE ledger SET balance = $1 WHERE id = $2', [balance, row.id])
  }

  await query('UPDATE agents SET balance = $1 WHERE id = $2', [balance, agentId])
  return balance
}

export async function updateVoucher(id, { agentId, amount, date, notes }) {
  const existing = await getVoucherById(id)
  const value = Number(amount)
  if (!value || value <= 0) throw new Error('المبلغ غير صالح')

  const agent = await getAgentRow(agentId)
  const entryDate = date || existing.date
  const description = notes?.trim() || (
    existing.type === 'سند قبض'
      ? `سند قبض — ${formatCurrency(value)}`
      : `سند صرف — ${formatCurrency(value)}`
  )

  const debit = existing.type === 'سند صرف' ? value : 0
  const credit = existing.type === 'سند قبض' ? value : 0

  await query(
    `UPDATE ledger
     SET \`date\` = $1, agent_id = $2, agent_name = $3, amount = $4,
         debit = $5, credit = $6, description = $7
     WHERE id = $8`,
    [entryDate, agentId, agent.name, value, debit, credit, String(description).slice(0, 500), id]
  )

  const agentsToRecalc = new Set([existing.agent_id, agentId])
  for (const aid of agentsToRecalc) {
    await recalcAgentBalances(aid)
  }

  return { id, agentId }
}

export async function deleteVoucher(id) {
  const existing = await getVoucherById(id)
  await query('DELETE FROM ledger WHERE id = $1', [id])
  await recalcAgentBalances(existing.agent_id)
  return { ok: true }
}

export async function getRecentVouchers(type, limit = 20) {
  return listVouchers({ type, allDates: true, limit })
}
