import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export function requireAgentAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, env.jwtSecret)
    if (payload.type !== 'agent') {
      return res.status(403).json({ message: 'غير مصرح لهذا التطبيق' })
    }
    req.agent = payload
    next()
  } catch {
    return res.status(401).json({ message: 'جلسة غير صالحة' })
  }
}
