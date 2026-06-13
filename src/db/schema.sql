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
  chars INT NOT NULL DEFAULT 2,
  CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  duration VARCHAR(100) NOT NULL,
  data_quota VARCHAR(100) NOT NULL DEFAULT '1 جيجا',
  router_profile VARCHAR(255) NULL,
  router_source VARCHAR(20) NOT NULL DEFAULT 'hotspot'
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
  router_source VARCHAR(20) NOT NULL DEFAULT 'hotspot',
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
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
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
);

CREATE TABLE IF NOT EXISTS recharge_carriers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'نشط',
  sort_order INT DEFAULT 0
);

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
);

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
);

CREATE TABLE IF NOT EXISTS recharge_provider_services (
  provider_id INT NOT NULL,
  service_id INT NOT NULL,
  PRIMARY KEY (provider_id, service_id),
  FOREIGN KEY (provider_id) REFERENCES recharge_providers(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES recharge_services(id) ON DELETE CASCADE
);
