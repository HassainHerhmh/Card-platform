import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

function prepareSql(sql) {
  return sql
    .replace(/\$(\d+)/g, '?')
    .replace(/::int/gi, '')
    .replace(/::float/gi, '')
    .replace(/::jsonb/gi, '')
    .replace(/"(\w+)"/g, '$1')
    .replace(/ON CONFLICT \(id\) DO NOTHING/gi, 'ON DUPLICATE KEY UPDATE id = id')
    .replace(
      /ON CONFLICT \(id\) DO UPDATE SET digits = EXCLUDED\.digits, chars = EXCLUDED\.chars/gi,
      'ON DUPLICATE KEY UPDATE digits = VALUES(digits), chars = VALUES(chars)'
    )
    .replace(
      /ON CONFLICT \(user_id\) DO UPDATE SET permissions = EXCLUDED\.permissions/gi,
      'ON DUPLICATE KEY UPDATE permissions = VALUES(permissions)'
    )
}

export const pool = env.databaseUrl
  ? mysql.createPool({
      uri: env.databaseUrl,
      waitForConnections: true,
      connectionLimit: 10,
      ssl: env.nodeEnv === 'production' ? {} : undefined,
    })
  : null

export async function query(text, params = []) {
  if (!pool) throw new Error('DATABASE_URL غير مضبوط')

  const sql = prepareSql(text)
  const [result] = await pool.execute(sql, params)

  if (Array.isArray(result)) {
    return { rows: result, insertId: null }
  }

  return { rows: [], insertId: result.insertId, affectedRows: result.affectedRows }
}
