import { RouterOSAPI } from 'node-routeros'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'

const CONFIG_ROW_ID = 1

/** @type {import('./mikrotik-connection.service.js').MikrotikRuntimeConfig | null} */
let cachedRuntimeConfig = null

function parseHostPort(hostRaw, portRaw) {
  let host = String(hostRaw || '').trim()
  let port = Number(portRaw) || 8728

  if (host.includes(':')) {
    const idx = host.lastIndexOf(':')
    const maybePort = Number(host.slice(idx + 1))
    if (maybePort) {
      port = maybePort
      host = host.slice(0, idx)
    }
  }

  return { host, port }
}

function buildRuntimeConfig(row) {
  if (!row?.host || !row?.username) return null

  const password = row.password || ''
  if (!password) return null

  const { host, port } = parseHostPort(row.host, row.port)

  return {
    host,
    port,
    user: row.username,
    password,
    tls: row.use_tls ? { rejectUnauthorized: false } : undefined,
    hostType: row.host_type || 'domain',
    quickLogin: row.quick_login !== 0 && row.quick_login !== false,
    source: 'database',
  }
}

function buildEnvRuntimeConfig() {
  const { host, port } = parseHostPort(env.mikrotik.host, env.mikrotik.port)
  if (!host || !env.mikrotik.user || !env.mikrotik.password) return null

  return {
    host,
    port,
    user: env.mikrotik.user,
    password: env.mikrotik.password,
    tls: env.mikrotik.useTls ? { rejectUnauthorized: false } : undefined,
    hostType: 'domain',
    quickLogin: true,
    source: 'env',
  }
}

export function resolveMikrotikConnectionConfig() {
  if (cachedRuntimeConfig?.host) return cachedRuntimeConfig
  return buildEnvRuntimeConfig() || {
    host: '',
    port: env.mikrotik.port || 8728,
    user: '',
    password: '',
    tls: undefined,
    hostType: 'domain',
    quickLogin: true,
    source: 'none',
  }
}

export function isQuickLoginEnabled() {
  return resolveMikrotikConnectionConfig().quickLogin !== false
}

export async function refreshMikrotikConnectionCache() {
  try {
    const { rows } = await query(
      `SELECT host_type, host, port, username, password, use_tls, quick_login
       FROM mikrotik_connection_config WHERE id = ? LIMIT 1`,
      [CONFIG_ROW_ID],
    )
    cachedRuntimeConfig = buildRuntimeConfig(rows[0]) || buildEnvRuntimeConfig()
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      cachedRuntimeConfig = buildEnvRuntimeConfig()
    } else {
      console.warn('[mikrotik-connection] cache refresh failed:', error.message)
      cachedRuntimeConfig = buildEnvRuntimeConfig()
    }
  }
  return cachedRuntimeConfig
}

function toPublicView(row, runtime) {
  const cfg = runtime || resolveMikrotikConnectionConfig()
  const configured = Boolean(cfg.host && cfg.user && cfg.password)

  return {
    configured,
    hostType: row?.host_type || cfg.hostType || 'domain',
    host: row?.host ? parseHostPort(row.host, row.port).host : cfg.host || '',
    port: row?.port || cfg.port || 8728,
    username: row?.username || cfg.user || '',
    hasPassword: Boolean(row?.password || cfg.password),
    useTls: Boolean(row?.use_tls ?? env.mikrotik.useTls),
    quickLogin: row?.quick_login != null
      ? row.quick_login !== 0
      : cfg.quickLogin !== false,
    source: configured ? (cfg.source || 'none') : 'none',
    updatedAt: row?.updated_at || null,
    displayHost: configured ? `${cfg.host}:${cfg.port}` : '',
  }
}

export async function getConnectionSettings() {
  try {
    const { rows } = await query(
      `SELECT host_type, host, port, username, password, use_tls, quick_login, updated_at
       FROM mikrotik_connection_config WHERE id = ? LIMIT 1`,
      [CONFIG_ROW_ID],
    )
    const row = rows[0]
    if (row) {
      return toPublicView(row, buildRuntimeConfig(row))
    }
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error
  }

  return toPublicView(null, resolveMikrotikConnectionConfig())
}

export async function saveConnectionSettings(input) {
  const hostType = input.hostType === 'ip' ? 'ip' : 'domain'
  const { host, port } = parseHostPort(input.host, input.port)
  const username = String(input.username || '').trim()
  const useTls = input.useTls === true || input.useTls === 'true' || input.useTls === 1
  const quickLogin = input.quickLogin !== false && input.quickLogin !== 'false' && input.quickLogin !== 0

  if (!host || !username) {
    throw new Error('العنوان واسم المستخدم مطلوبان')
  }

  let password = String(input.password || '')
  if (!password) {
    const { rows } = await query(
      'SELECT password FROM mikrotik_connection_config WHERE id = ? LIMIT 1',
      [CONFIG_ROW_ID],
    )
    password = rows[0]?.password || ''
  }

  if (!password) {
    throw new Error('كلمة السر مطلوبة')
  }

  await query(
    `INSERT INTO mikrotik_connection_config
      (id, host_type, host, port, username, password, use_tls, quick_login)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      host_type = VALUES(host_type),
      host = VALUES(host),
      port = VALUES(port),
      username = VALUES(username),
      password = VALUES(password),
      use_tls = VALUES(use_tls),
      quick_login = VALUES(quick_login)`,
    [CONFIG_ROW_ID, hostType, host, port, username, password, useTls ? 1 : 0, quickLogin ? 1 : 0],
  )

  await refreshMikrotikConnectionCache()

  const settings = await getConnectionSettings()
  return settings
}

function mapTestError(error) {
  const msg = error?.message || String(error)
  if (msg.includes('ECONNREFUSED')) return 'رفض الراوتر الاتصال — تحقق من العنوان والبورت'
  if (msg.includes('ETIMEDOUT') || msg.includes('CONNECT_TIMEOUT')) return 'انتهت مهلة الاتصال — تحقق من العنوان والبورت'
  if (msg.includes('invalid user name or password') || msg.includes('cannot log in')) {
    return 'اسم المستخدم أو كلمة السر غير صحيحة'
  }
  return msg
}

export async function testMikrotikConnection(input) {
  const hostType = input.hostType === 'ip' ? 'ip' : 'domain'
  const { host, port } = parseHostPort(input.host, input.port)
  const username = String(input.username || '').trim()
  let password = String(input.password || '')

  if (!password && input.useStoredPassword) {
    const cfg = resolveMikrotikConnectionConfig()
    password = cfg.password || ''
  }

  if (!host || !username || !password) {
    throw new Error('أكمل العنوان واسم المستخدم وكلمة السر')
  }

  const useTls = input.useTls === true || input.useTls === 'true' || input.useTls === 1
  const connectTimeout = Math.max(5, Number(env.mikrotik.connectTimeout) || 12)

  const api = new RouterOSAPI({
    host,
    port,
    user: username,
    password,
    timeout: connectTimeout,
    tls: useTls ? { rejectUnauthorized: false } : undefined,
  })

  const started = Date.now()

  try {
    await Promise.race([
      api.connect(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), connectTimeout * 1000)
      }),
    ])

    const [identityRows, resourceRows] = await Promise.all([
      api.write('/system/identity/print'),
      api.write('/system/resource/print'),
    ])

    const identity = identityRows?.[0] || {}
    const resource = resourceRows?.[0] || {}

    return {
      ok: true,
      host: `${host}:${port}`,
      hostType,
      identity: identity.name || 'MikroTik',
      version: resource.version || '',
      boardName: resource['board-name'] || '',
      latencyMs: Date.now() - started,
      message: `متصل — ${identity.name || host}`,
    }
  } catch (error) {
    return {
      ok: false,
      host: `${host}:${port}`,
      hostType,
      message: mapTestError(error),
      latencyMs: Date.now() - started,
    }
  } finally {
    try {
      await Promise.race([
        Promise.resolve().then(() => api.close()),
        new Promise((resolve) => { setTimeout(resolve, 2000) }),
      ])
    } catch {
      // ignore
    }
  }
}
