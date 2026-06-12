import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(__dirname, '../../logs')
const LOG_FILE = join(LOG_DIR, 'client-errors.log')
const MAX_ERRORS = 200
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

const errors = []
const rateBuckets = new Map()

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
}

function writeLog(entry) {
  try {
    ensureLogDir()
    appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // ignore file write failures on read-only filesystems
  }
}

function isRateLimited(ip) {
  const now = Date.now()
  const bucket = rateBuckets.get(ip) || []
  const recent = bucket.filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) return true
  recent.push(now)
  rateBuckets.set(ip, recent)
  return false
}

export function reportClientError(ip, payload) {
  if (isRateLimited(ip)) return null

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...payload,
    ip,
    receivedAt: new Date().toISOString(),
  }

  errors.unshift(entry)
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS

  console.error('[CLIENT-ERROR]', JSON.stringify(entry))
  writeLog(entry)

  return entry.id
}

export function getClientErrors({ limit = 50 } = {}) {
  return errors.slice(0, Math.min(limit, MAX_ERRORS))
}

export function clearClientErrors() {
  errors.length = 0
}
