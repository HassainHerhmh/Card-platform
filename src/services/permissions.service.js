import { query } from '../db/pool.js'

function parsePermissions(value) {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

export async function getUserPermissions(userId) {
  const { rows } = await query('SELECT permissions FROM user_permissions WHERE user_id = $1', [userId])
  return parsePermissions(rows[0]?.permissions)
}

export async function saveUserPermissions(userId, permissions) {
  await query(
    `INSERT INTO user_permissions (user_id, permissions)
     VALUES ($1, $2)
     ON DUPLICATE KEY UPDATE permissions = VALUES(permissions)`,
    [userId, JSON.stringify(permissions)]
  )
}
