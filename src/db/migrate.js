import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { pool } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate() {
  if (!pool) {
    console.warn('DATABASE_URL / MYSQL_URL missing — skipping migration')
    return
  }

  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  for (const statement of statements) {
    await pool.execute(statement)
  }

  const patches = [
    'ALTER TABLE agents ADD COLUMN address VARCHAR(500) NULL',
    'ALTER TABLE agents ADD COLUMN password_hash VARCHAR(255) NULL',
  ]

  for (const patch of patches) {
    try {
      await pool.execute(patch)
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error
    }
  }

  console.log('Database schema ready')
}
