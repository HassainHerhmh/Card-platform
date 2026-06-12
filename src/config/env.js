import dotenv from 'dotenv'

dotenv.config()

export const env = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  mikrotik: {
    host: process.env.MIKROTIK_HOST || '',
    port: Number(process.env.MIKROTIK_PORT) || 8728,
    user: process.env.MIKROTIK_USER || '',
    password: process.env.MIKROTIK_PASSWORD || '',
    useTls: process.env.MIKROTIK_USE_TLS === 'true',
  },
}
