import bcrypt from 'bcryptjs'
import { pool, query } from './pool.js'

export async function seed() {
  if (!pool) {
    console.warn('DATABASE_URL / MYSQL_URL missing — skipping seed')
    return
  }

  const { rows } = await query('SELECT COUNT(*) AS count FROM platform_users')
  if (Number(rows[0].count) > 0) return

  const passwordHash = await bcrypt.hash('123456', 10)

  await query(
    `INSERT INTO platform_users (name, username, email, password_hash, role, status, last_login)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    ['مدير النظام', 'admin', 'admin@cards.com', passwordHash, 'مدير', 'نشط', new Date()]
  )

  await query(
    'INSERT INTO card_settings (id, digits, chars) VALUES (1, 8, 12) ON DUPLICATE KEY UPDATE id = id'
  )

  const categories = [
    ['كرت ابو 100', 100, '24 ساعة', '5 جيجا'],
    ['يومي', 5, '24 ساعة', '1 جيجا'],
    ['أسبوعي', 25, 'أسبوع', '10 جيجا'],
    ['شهري', 75, 'شهر', '50 جيجا'],
  ]
  for (const [name, price, duration, dataQuota] of categories) {
    await query(
      'INSERT INTO categories (name, price, duration, data_quota) VALUES ($1, $2, $3, $4)',
      [name, price, duration, dataQuota]
    )
  }

  const agentPasswordHash = await bcrypt.hash('123456', 10)
  const agents = [
    ['أحمد السالم', '0501234567', 'الرياض', 15000, 'نشط', 245],
    ['محمد العتيبي', '0559876543', 'جدة', 8500, 'نشط', 178],
    ['خالد الدوسري', '0541112233', 'الدمام', 3200, 'معلق', 92],
    ['فهد القحطاني', '0567778899', 'مكة', 22000, 'نشط', 410],
  ]
  for (const [name, phone, address, balance, status, cardsSold] of agents) {
    await query(
      `INSERT INTO agents (name, phone, address, password_hash, balance, status, cards_sold)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, phone, address, agentPasswordHash, balance, status, cardsSold]
    )
  }

  const routers = [
    ['راوتر الرئيسي', '192.168.88.1', 1250],
    ['راوتر الفرع الشمالي', '192.168.89.1', 680],
    ['راوتر الفرع الجنوبي', '192.168.90.1', 420],
  ]
  for (const [name, ip, cardsPrinted] of routers) {
    await query('INSERT INTO mikrotik_routers (name, ip, cards_printed) VALUES ($1, $2, $3)', [name, ip, cardsPrinted])
  }

  const ledger = [
    ['2026-06-12', 1, 'أحمد السالم', 'بيع', 50, 1250, 15000],
    ['2026-06-11', 2, 'محمد العتيبي', 'بيع', 30, 750, 8500],
    ['2026-06-10', 4, 'فهد القحطاني', 'إيداع', 0, 5000, 22000],
    ['2026-06-09', 3, 'خالد الدوسري', 'بيع', 20, 400, 3200],
    ['2026-06-08', 1, 'أحمد السالم', 'سحب', 0, -2000, 13000],
  ]
  for (const [date, agentId, agentName, type, cards, amount, balance] of ledger) {
    await query(
      'INSERT INTO ledger (`date`, agent_id, agent_name, `type`, cards, amount, balance) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [date, agentId, agentName, type, cards, amount, balance]
    )
  }

  console.log('Database seeded')
}
