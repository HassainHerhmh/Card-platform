import { env } from '../config/env.js'

export function requireGatewayAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'غير مصرح' })
  }

  const token = header.slice(7)
  if (!env.smsGatewayToken || token !== env.smsGatewayToken) {
    return res.status(403).json({ message: 'رمز بوابة SMS غير صحيح' })
  }

  next()
}
