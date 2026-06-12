import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { requireAuth } from '../middleware/auth.js'
import * as clientErrorsService from '../services/client-errors.service.js'

const router = Router()

function optionalUser(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  try {
    return jwt.verify(header.slice(7), env.jwtSecret)
  } catch {
    return null
  }
}

router.post('/report', (req, res) => {
  const { type, message, stack, componentStack, url, userAgent, timestamp } = req.body || {}
  if (!message) {
    return res.status(400).json({ message: 'message مطلوب' })
  }

  const user = optionalUser(req)
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'

  clientErrorsService.reportClientError(ip, {
    type: type || 'unknown',
    message: String(message).slice(0, 2000),
    stack: stack ? String(stack).slice(0, 4000) : '',
    componentStack: componentStack ? String(componentStack).slice(0, 4000) : '',
    url: url ? String(url).slice(0, 500) : '',
    userAgent: userAgent ? String(userAgent).slice(0, 300) : '',
    clientTimestamp: timestamp || null,
    userId: user?.id || req.body?.userId || null,
    username: user?.username || req.body?.username || null,
  })

  res.status(204).end()
})

router.get('/', requireAuth, (req, res) => {
  if (req.user.role !== 'مدير') {
    return res.status(403).json({ message: 'للمدير فقط' })
  }
  const limit = Math.min(+req.query.limit || 50, 200)
  res.json({ errors: clientErrorsService.getClientErrors({ limit }) })
})

router.delete('/', requireAuth, (req, res) => {
  if (req.user.role !== 'مدير') {
    return res.status(403).json({ message: 'للمدير فقط' })
  }
  clientErrorsService.clearClientErrors()
  res.json({ ok: true })
})

export default router
