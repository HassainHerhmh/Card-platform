import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import authRoutes from './routes/auth.routes.js'
import usersRoutes from './routes/users.routes.js'
import cardsRoutes from './routes/cards.routes.js'
import mikrotikRoutes from './routes/mikrotik.routes.js'

const app = express()

app.use(cors({ origin: env.clientUrl, credentials: true }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'card-platform-api' })
})

app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/cards', cardsRoutes)
app.use('/api/mikrotik', mikrotikRoutes)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ message: 'خطأ داخلي في السيرفر' })
})

export default app
