import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import bcrypt from 'bcryptjs'
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

  const defaultAgentHash = await bcrypt.hash('123456', 10)
  await pool.execute(
    'UPDATE agents SET password_hash = ? WHERE password_hash IS NULL OR password_hash = \'\'',
    [defaultAgentHash]
  )

  const seedPhones = ['0501234567', '0559876543', '0541112233', '0567778899']
  for (const phone of seedPhones) {
    await pool.execute('UPDATE agents SET password_hash = ? WHERE phone = ?', [defaultAgentHash, phone])
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS agent_devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      device_id VARCHAR(100) NOT NULL,
      label VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      UNIQUE KEY unique_agent_device (agent_id, device_id)
    )
  `)

  console.log('Database schema ready')
}
