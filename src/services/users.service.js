import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { formatDateTime } from '../utils/format.js'

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role: row.role,
    status: row.status,
    lastLogin: formatDateTime(row.last_login),
  }
}

export async function findByUsername(username) {
  const { rows } = await query('SELECT * FROM platform_users WHERE username = $1', [username])
  return rows[0] || null
}

export async function getAllUsers() {
  const { rows } = await query('SELECT * FROM platform_users ORDER BY id')
  return rows.map(mapUser)
}

export async function createUser({ name, username, email, role, password }) {
  const passwordHash = await bcrypt.hash(password, 10)
  const { insertId } = await query(
    `INSERT INTO platform_users (name, username, email, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5, 'نشط')`,
    [name, username, email, passwordHash, role]
  )
  const { rows } = await query('SELECT * FROM platform_users WHERE id = $1', [insertId])
  return mapUser(rows[0])
}

export async function updateUser(id, { name, username, email, role }) {
  await query(
    'UPDATE platform_users SET name = $1, username = $2, email = $3, role = $4 WHERE id = $5',
    [name, username, email, role, id]
  )
  const { rows } = await query('SELECT * FROM platform_users WHERE id = $1', [id])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function updatePassword(id, password) {
  const passwordHash = await bcrypt.hash(password, 10)
  await query('UPDATE platform_users SET password_hash = $1 WHERE id = $2', [passwordHash, id])
}

export async function toggleUserStatus(id) {
  await query(
    `UPDATE platform_users SET status = CASE WHEN status = 'نشط' THEN 'موقوف' ELSE 'نشط' END
     WHERE id = $1`,
    [id]
  )
  const { rows } = await query('SELECT * FROM platform_users WHERE id = $1', [id])
  return rows[0] ? mapUser(rows[0]) : null
}

export async function deleteUser(id) {
  await query('DELETE FROM platform_users WHERE id = $1', [id])
}

export async function updateLastLogin(id) {
  await query('UPDATE platform_users SET last_login = NOW() WHERE id = $1', [id])
}

export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash)
}
