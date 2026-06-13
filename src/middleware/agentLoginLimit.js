const FAIL_MAX = 10
const FAIL_WINDOW_MS = 15 * 60 * 1000
const LOCK_DURATIONS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
]

const failures = new Map()
const locks = new Map()

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function lockKey(req, phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  return `${clientIp(req)}:${digits || 'unknown'}`
}

function lockMessage(remainingMs) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000))
  return `تم حظر الدخول مؤقتاً — حاول بعد ${minutes} دقيقة`
}

export function getAgentLoginLock(req, phone) {
  const key = lockKey(req, phone)
  const lock = locks.get(key)
  if (!lock) return null

  const remaining = lock.until - Date.now()
  if (remaining <= 0) {
    locks.delete(key)
    return null
  }

  return { until: lock.until, message: lockMessage(remaining) }
}

export function recordAgentLoginFailure(req, phone) {
  const key = lockKey(req, phone)
  const now = Date.now()

  let bucket = failures.get(key)
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + FAIL_WINDOW_MS }
    failures.set(key, bucket)
  }

  bucket.count += 1
  if (bucket.count < FAIL_MAX) return null

  const prev = locks.get(key)
  const level = Math.min((prev?.level ?? -1) + 1, LOCK_DURATIONS_MS.length - 1)
  const duration = LOCK_DURATIONS_MS[level]

  locks.set(key, { until: now + duration, level })
  failures.delete(key)

  return { until: now + duration, message: lockMessage(duration) }
}

export function clearAgentLoginFailures(req, phone) {
  const key = lockKey(req, phone)
  failures.delete(key)
  locks.delete(key)
}
