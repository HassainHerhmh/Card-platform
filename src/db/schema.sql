CREATE TABLE IF NOT EXISTS platform_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'موظف',
  status VARCHAR(50) NOT NULL DEFAULT 'نشط',
  last_login TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS card_settings (
  id INT PRIMARY KEY DEFAULT 1,
  digits INT NOT NULL DEFAULT 8,
  chars INT NOT NULL DEFAULT 12,
  CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  duration VARCHAR(100) NOT NULL,
  data_quota VARCHAR(100) NOT NULL DEFAULT '1 جيجا'
);

CREATE TABLE IF NOT EXISTS agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  address VARCHAR(500),
  password_hash VARCHAR(255) NOT NULL,
  balance DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'نشط',
  cards_sold INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT,
  category_name VARCHAR(255) NOT NULL,
  agent_id INT,
  agent_name VARCHAR(255) NOT NULL DEFAULT '-',
  `count` INT NOT NULL,
  printed_at DATE NOT NULL DEFAULT (CURRENT_DATE),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  code VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'معلق',
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `date` DATE NOT NULL,
  agent_id INT,
  agent_name VARCHAR(255),
  `type` VARCHAR(50) NOT NULL,
  cards INT DEFAULT 0,
  amount DECIMAL(12, 2) NOT NULL,
  balance DECIMAL(12, 2) NOT NULL,
  debit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  credit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  description VARCHAR(500),
  reference_id INT NULL,
  INDEX idx_ledger_agent_date (agent_id, `date`)
);

CREATE TABLE IF NOT EXISTS mikrotik_routers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  ip VARCHAR(100) NOT NULL,
  cards_printed INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  label VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
  UNIQUE KEY unique_agent_device (agent_id, device_id)
);

CREATE TABLE IF NOT EXISTS sms_gateway_heartbeat (
  id TINYINT PRIMARY KEY DEFAULT 1,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT PRIMARY KEY,
  permissions JSON NOT NULL,
  FOREIGN KEY (user_id) REFERENCES platform_users(id) ON DELETE CASCADE
);
