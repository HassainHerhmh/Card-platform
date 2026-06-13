import dotenv from 'dotenv'

dotenv.config()

function pick(...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key]
  }
  return ''
}

function buildDatabaseUrl() {
  const direct = pick('DATABASE_URL', 'MYSQL_URL', 'MYSQL_PUBLIC_URL')
  if (direct) return direct

  const host = pick('MYSQLHOST', 'MYSQL_HOST')
  const port = pick('MYSQLPORT', 'MYSQL_PORT') || '3306'
  const user = pick('MYSQLUSER', 'MYSQL_USER')
  const password = pick('MYSQLPASSWORD', 'MYSQL_PASSWORD')
  const database = pick('MYSQLDATABASE', 'MYSQL_DATABASE')

  if (host && user && password && database) {
    return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
  }

  return ''
}

export const env = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  smsGatewayToken: process.env.SMS_GATEWAY_TOKEN || '',
  smsGatewayDeviceId: process.env.SMS_GATEWAY_DEVICE_ID || '',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  databaseUrl: buildDatabaseUrl(),
  mikrotik: {
    host: process.env.MIKROTIK_HOST || '',
    port: Number(process.env.MIKROTIK_PORT) || 8728,
    user: process.env.MIKROTIK_USER || '',
    password: process.env.MIKROTIK_PASSWORD || '',
    useTls: process.env.MIKROTIK_USE_TLS === 'true',
    userManagerCustomer: process.env.MIKROTIK_UM_CUSTOMER || 'admin',
  },
}
