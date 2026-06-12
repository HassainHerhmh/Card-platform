import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import authRoutes from './routes/auth.routes.js'
import usersRoutes from './routes/users.routes.js'
import settingsRoutes from './routes/settings.routes.js'
import agentsRoutes from './routes/agents.routes.js'
import cardsRoutes from './routes/cards.routes.js'
import ledgerRoutes from './routes/ledger.routes.js'
import reportsRoutes from './routes/reports.routes.js'
import permissionsRoutes from './routes/permissions.routes.js'
import mikrotikRoutes from './routes/mikrotik.routes.js'
import errorsRoutes from './routes/errors.routes.js'
import agentAuthRoutes from './routes/agent-auth.routes.js'
import agentAppRoutes from './routes/agent-app.routes.js'

const app = express()

const allowedOrigins = env.clientUrl
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

app.use(cors({
  origin(origin, callback) {
    if (
      !origin
      || allowedOrigins.includes(origin)
      || isLocalOrigin(origin)
      || env.nodeEnv !== 'production'
    ) {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '100kb' }))

app.get('/api/health', async (_req, res) => {
  let dbConnected = false
  if (env.databaseUrl) {
    try {
      const { pool } = await import('./db/pool.js')
      if (pool) {
        await pool.execute('SELECT 1')
        dbConnected = true
      }
    } catch {
      dbConnected = false
    }
  }
  res.json({
    ok: true,
    service: 'card-platform-api',
    database: !!env.databaseUrl,
    dbConnected,
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/agent-auth', agentAuthRoutes)
app.use('/api/agent-app', agentAppRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/agents', agentsRoutes)
app.use('/api/cards', cardsRoutes)
app.use('/api/ledger', ledgerRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/permissions', permissionsRoutes)
app.use('/api/mikrotik', mikrotikRoutes)
app.use('/api/errors', errorsRoutes)

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    console.error('[BAD-JSON]', err.body || err.message)
    return res.status(400).json({ message: 'بيانات الطلب غير صالحة' })
  }
  if (err.status === 400) {
    return res.status(400).json({ message: err.message || 'طلب غير صالح' })
  }
  console.error(err)
  res.status(500).json({ message: 'خطأ داخلي في السيرفر' })
})

export default app
