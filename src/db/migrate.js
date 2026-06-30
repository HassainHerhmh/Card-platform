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
    'ALTER TABLE recharge_providers ADD COLUMN provider_type VARCHAR(100) DEFAULT ""',
    'ALTER TABLE categories ADD COLUMN router_profile VARCHAR(255) NULL',
    "ALTER TABLE categories ADD COLUMN router_source VARCHAR(20) NOT NULL DEFAULT 'hotspot'",
    "ALTER TABLE batches ADD COLUMN router_source VARCHAR(20) NOT NULL DEFAULT 'hotspot'",
    'ALTER TABLE categories ADD COLUMN duration_hours INT NOT NULL DEFAULT 24',
    'ALTER TABLE categories ADD COLUMN duration_minutes INT NOT NULL DEFAULT 0',
    'ALTER TABLE transit_account_settings ADD COLUMN card_income_account INT NULL',
    `CREATE TABLE IF NOT EXISTS print_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      category_id INT NULL,
      config JSON NOT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    'ALTER TABLE print_templates ADD COLUMN category_id INT NULL',
    `CREATE TABLE IF NOT EXISTS agent_notebook_data (
      agent_id INT PRIMARY KEY,
      payload JSON NOT NULL,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS mikrotik_connection_config (
      id TINYINT PRIMARY KEY DEFAULT 1,
      host_type VARCHAR(10) NOT NULL DEFAULT 'domain',
      host VARCHAR(255) NOT NULL DEFAULT '',
      port INT NOT NULL DEFAULT 8728,
      username VARCHAR(255) NOT NULL DEFAULT '',
      password VARCHAR(500) NOT NULL DEFAULT '',
      use_tls TINYINT(1) NOT NULL DEFAULT 0,
      quick_login TINYINT(1) NOT NULL DEFAULT 1,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
    'ALTER TABLE mikrotik_routers ADD COLUMN display_name VARCHAR(255) NULL',
    'ALTER TABLE mikrotik_routers ADD COLUMN logo_url MEDIUMTEXT NULL',
    `CREATE TABLE IF NOT EXISTS agent_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      batch_id INT NULL,
      type VARCHAR(30) NOT NULL DEFAULT 'delivery',
      category_name VARCHAR(255) NOT NULL DEFAULT '',
      card_count INT NOT NULL DEFAULT 0,
      amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
      title VARCHAR(255) NOT NULL,
      body VARCHAR(500) NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      INDEX idx_agent_notifications_agent (agent_id, is_read, created_at),
      UNIQUE KEY uniq_agent_batch_delivery (agent_id, batch_id, type)
    )`,
  ]

  for (const patch of patches) {
    try {
      await pool.execute(patch)
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error
    }
  }

  try {
    await pool.execute(`
      UPDATE mikrotik_routers
      SET display_name = name
      WHERE display_name IS NULL OR TRIM(display_name) = ''
    `)
  } catch (error) {
    console.warn('mikrotik_routers display_name backfill skipped:', error.message)
  }

  try {
    await pool.execute(`
      UPDATE ledger l
      INNER JOIN (
        SELECT l2.id AS ledger_id, MAX(sq.created_at) AS ts
        FROM ledger l2
        INNER JOIN sms_queue sq ON sq.agent_id = l2.agent_id
        INNER JOIN cards c ON c.id = sq.card_id AND l2.description LIKE CONCAT('%كود ', c.code)
        WHERE l2.type = 'بيع'
        GROUP BY l2.id
      ) src ON src.ledger_id = l.id
      SET l.created_at = src.ts
      WHERE l.created_at IS NULL
    `)
  } catch (error) {
    console.warn('ledger created_at backfill skipped:', error.message)
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

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recharge_provider_config (
      id INT PRIMARY KEY DEFAULT 1,
      provider_name VARCHAR(255) NOT NULL DEFAULT '',
      api_url VARCHAR(500) NOT NULL DEFAULT '',
      api_ip VARCHAR(100) DEFAULT '',
      account_number VARCHAR(100) DEFAULT '',
      username VARCHAR(255) DEFAULT '',
      password VARCHAR(255) DEFAULT '',
      token VARCHAR(500) DEFAULT '',
      employee_note VARCHAR(255) DEFAULT '',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recharge_carriers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'نشط',
      sort_order INT DEFAULT 0
    )
  `)

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recharge_services (
      id INT AUTO_INCREMENT PRIMARY KEY,
      carrier_id INT NOT NULL,
      service_code VARCHAR(100) NOT NULL,
      name VARCHAR(255) NOT NULL,
      service_type VARCHAR(50) NOT NULL DEFAULT 'فوري',
      price DECIMAL(12, 2) NOT NULL DEFAULT 0,
      commission_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'نشط',
      FOREIGN KEY (carrier_id) REFERENCES recharge_carriers(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_carrier_service (carrier_id, service_code)
    )
  `)

  await pool.execute(`
    INSERT IGNORE INTO recharge_carriers (code, name, sort_order) VALUES
      ('yemen_mobile', 'يمن موبايل', 1),
      ('you', 'YOU', 2),
      ('sabafon', 'سبافون', 3)
  `)

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recharge_providers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider_name VARCHAR(255) NOT NULL,
      api_url VARCHAR(500) NOT NULL DEFAULT '',
      api_ip VARCHAR(100) DEFAULT '',
      account_number VARCHAR(100) DEFAULT '',
      username VARCHAR(255) DEFAULT '',
      password VARCHAR(255) DEFAULT '',
      token VARCHAR(500) DEFAULT '',
      employee_note VARCHAR(255) DEFAULT '',
      provider_type VARCHAR(100) DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'نشط',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS recharge_provider_services (
      provider_id INT NOT NULL,
      service_id INT NOT NULL,
      PRIMARY KEY (provider_id, service_id),
      FOREIGN KEY (provider_id) REFERENCES recharge_providers(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES recharge_services(id) ON DELETE CASCADE
    )
  `)

  const [legacyRows] = await pool.execute(
    "SELECT provider_name FROM recharge_provider_config WHERE id = 1 AND provider_name != '' LIMIT 1"
  )
  const [newRows] = await pool.execute('SELECT id FROM recharge_providers LIMIT 1')
  if (legacyRows.length && !newRows.length) {
    const [legacy] = await pool.execute('SELECT * FROM recharge_provider_config WHERE id = 1')
    const row = legacy[0]
    if (row?.provider_name) {
      await pool.execute(
        `INSERT INTO recharge_providers
          (provider_name, api_url, api_ip, account_number, username, password, token, employee_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.provider_name, row.api_url, row.api_ip, row.account_number,
          row.username, row.password, row.token, row.employee_note,
        ]
      )
    }
  }

  console.log('Database schema ready')

  await pool.execute(`
    DELETE FROM mikrotik_routers
    WHERE ip IN ('192.168.89.1', '192.168.90.1')
       OR name LIKE '%الفرع%'
  `)

  const [mainRows] = await pool.execute('SELECT MIN(id) AS id FROM mikrotik_routers')
  if (mainRows[0]?.id) {
    await pool.execute(
      'UPDATE mikrotik_routers SET name = ?, ip = ? WHERE id = ?',
      ['راوتر الرئيسي', 'hslink.pro:7227', mainRows[0].id]
    )
  }

  // إزالة العدد التجريبي القديم — يُحدَّث لاحقاً من الراوتر مباشرة
  await pool.execute('UPDATE mikrotik_routers SET cards_printed = 0')

  // حذف فئات المنصة التجريبية (غير المرتبطة بالراوتر)
  await pool.execute(`
    DELETE c FROM categories c
    LEFT JOIN batches b ON b.category_id = c.id
    WHERE c.router_profile IS NULL AND b.id IS NULL
  `)

  // لا تحذف الدفعات تلقائياً — كان يمسح كل طباعة عند إعادة تشغيل السيرفر
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS router_inventory_cache (
      id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
      cards_blob MEDIUMBLOB NOT NULL,
      summary_json JSON NOT NULL,
      sources_json JSON NOT NULL,
      user_manager_json JSON NOT NULL,
      card_count INT NOT NULL DEFAULT 0,
      fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `)

  if (process.env.CLEAR_LEGACY_BATCHES === '1') {
    try {
      await pool.execute('DELETE FROM sms_queue WHERE card_id IS NOT NULL')
    } catch (error) {
      console.warn('sms_queue cleanup skipped:', error.message)
    }
    try {
      await pool.execute('UPDATE ledger SET reference_id = NULL WHERE reference_id IS NOT NULL')
    } catch (error) {
      console.warn('ledger reference cleanup skipped:', error.message)
    }
    await pool.execute('DELETE FROM cards')
    await pool.execute('DELETE FROM batches')
    console.log('All batches cleared (CLEAR_LEGACY_BATCHES=1)')
  }

  const { ensureAccountingTables } = await import('../services/accounting.service.js')
  await ensureAccountingTables()
}
