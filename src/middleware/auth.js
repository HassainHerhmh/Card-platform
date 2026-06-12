import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  try {
    const token = header.slice(7)
    req.user = jwt.verify(token, env.jwtSecret)
    next()
  } catch {
    return res.status(401).json({ message: 'جلسة غير صالحة' })
  }
}
