import { env } from '../config/env.js'
import { secureCompare } from '../utils/secureCompare.js'
import { clearGatewayAuthFailures, recordGatewayAuthFailure } from './gatewayRateLimit.js'

const MIN_TOKEN_LENGTH = 32
const UNAUTHORIZED = { message: 'غير مصرح' }

function readBearerToken(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

function readDeviceId(req) {
  const deviceId = req.headers['x-gateway-device']
  if (typeof deviceId !== 'string') return null
  const trimmed = deviceId.trim()
  return trimmed || null
}

export function requireGatewayAuth(req, res, next) {
  const token = readBearerToken(req)
  if (!token) {
    recordGatewayAuthFailure(req)
    return res.status(401).json(UNAUTHORIZED)
  }

  if (!env.smsGatewayToken || env.smsGatewayToken.length < MIN_TOKEN_LENGTH) {
    console.error('[gateway] SMS_GATEWAY_TOKEN missing or too short')
    return res.status(503).json({ message: 'الخدمة غير متاحة' })
  }

  if (token.length < MIN_TOKEN_LENGTH || !secureCompare(token, env.smsGatewayToken)) {
    recordGatewayAuthFailure(req)
    return res.status(401).json(UNAUTHORIZED)
  }

  if (env.smsGatewayDeviceId) {
    const deviceId = readDeviceId(req)
    if (!deviceId || !secureCompare(deviceId, env.smsGatewayDeviceId)) {
      recordGatewayAuthFailure(req)
      return res.status(401).json(UNAUTHORIZED)
    }
  }

  clearGatewayAuthFailures(req)
  next()
}
