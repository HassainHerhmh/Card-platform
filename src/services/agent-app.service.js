import { query } from '../db/pool.js'
import { formatDate } from '../utils/format.js'

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
  const { rows } = await query(
    `SELECT c.id, c.name, c.price, c.duration,
            COUNT(CASE WHEN ca.status = 'معلق' THEN 1 END) AS availableCards
     FROM categories c
     LEFT JOIN batches b ON b.category_id = c.id AND b.agent_id = $1
     LEFT JOIN cards ca ON ca.batch_id = b.id
     GROUP BY c.id, c.name, c.price, c.duration
     ORDER BY c.id`,
    [agentId]
  )
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: Number(row.price),
    duration: row.duration,
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

export async function getAgentTransactions(agentId, limit = 20) {
  const { rows } = await query(
    `SELECT id, \`date\`, \`type\`, cards, amount, balance
     FROM ledger
     WHERE agent_id = $1
     ORDER BY \`date\` DESC, id DESC
     LIMIT ${Math.min(Math.max(Number(limit) || 20, 1), 100)}`,
    [agentId]
  )

  return rows.map((row) => {
    const amount = Number(row.amount)
    const isSale = row.type === 'بيع'
    return {
      id: row.id,
      type: isSale ? 'تعبئة رصيد' : row.type,
      cardNumber: isSale ? `${String(row.id).padStart(3, '0')}000000` : '---',
      amount: Math.abs(amount),
      date: formatDate(row.date),
      status: isSale ? 'مكتمل' : '—',
      statusNote: isSale ? 'تم التأكيد' : '',
      statusType: isSale ? 'done' : 'pending',
    }
  })
}
