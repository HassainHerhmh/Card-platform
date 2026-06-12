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

const app = express()

const allowedOrigins = env.clientUrl
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || env.nodeEnv !== 'production') {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json())

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
app.use('/api/users', usersRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/agents', agentsRoutes)
app.use('/api/cards', cardsRoutes)
app.use('/api/ledger', ledgerRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/permissions', permissionsRoutes)
app.use('/api/mikrotik', mikrotikRoutes)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ message: 'خطأ داخلي في السيرفر' })
})

export default app
