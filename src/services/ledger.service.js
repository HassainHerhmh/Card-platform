import { query } from '../db/pool.js'
import { formatDate } from '../utils/format.js'

export async function getLedger() {
  const { rows } = await query(
    `SELECT id, \`date\`, agent_name AS agent, \`type\`, cards, amount, balance
     FROM ledger ORDER BY \`date\` DESC, id DESC`
  )
  return rows.map((row) => ({
    ...row,
    date: formatDate(row.date),
    amount: Number(row.amount),
    balance: Number(row.balance),
  }))
}
