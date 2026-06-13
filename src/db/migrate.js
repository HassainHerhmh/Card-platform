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
    "ALTER TABLE categories ADD COLUMN data_quota VARCHAR(100) NOT NULL DEFAULT '1 جيجا'",
    'ALTER TABLE ledger ADD COLUMN debit DECIMAL(12, 2) NOT NULL DEFAULT 0',
    'ALTER TABLE ledger ADD COLUMN credit DECIMAL(12, 2) NOT NULL DEFAULT 0',
    'ALTER TABLE ledger ADD COLUMN description VARCHAR(500) NULL',
    'ALTER TABLE ledger ADD COLUMN reference_id INT NULL',
    'ALTER TABLE ledger ADD COLUMN created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
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

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sms_gateway_heartbeat (
      id TINYINT PRIMARY KEY DEFAULT 1,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sms_queue (
      id INT AUTO_INCREMENT PRIMARY KEY,
      recipient_phone VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      agent_id INT,
      card_id INT,
      category_name VARCHAR(255),
      network_name VARCHAR(255),
      error_message VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
      INDEX idx_sms_queue_status (status)
    )
  `)

  console.log('Database schema ready')
}
