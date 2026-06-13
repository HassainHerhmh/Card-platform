import { RouterOSAPI } from 'node-routeros'
import { env } from '../config/env.js'

function getConnectionConfig() {
  let host = env.mikrotik.host.trim()
  let port = env.mikrotik.port

  if (host.includes(':')) {
    const idx = host.lastIndexOf(':')
    const maybePort = Number(host.slice(idx + 1))
    if (maybePort) {
      port = maybePort
      host = host.slice(0, idx)
    }
  }

  return {
    host,
    port,
    user: env.mikrotik.user,
    password: env.mikrotik.password,
    timeout: 15,
    tls: env.mikrotik.useTls ? { rejectUnauthorized: false } : undefined,
  }
}

function formatHost(cfg) {
  if (!cfg.host) return ''
  return `${cfg.host}:${cfg.port}`
}

async function withConnection(fn) {
  const cfg = getConnectionConfig()
  if (!cfg.host || !cfg.user || !cfg.password) {
    throw new Error('إعدادات الميكروتك غير مكتملة في ملف .env على السيرفر')
  }

  const api = new RouterOSAPI({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    timeout: cfg.timeout,
    tls: cfg.tls,
  })

  try {
    await api.connect()
    return await fn(api, cfg)
  } finally {
    try {
      api.close()
    } catch {
      // ignore close errors
    }
  }
}

function mapConnectionError(error) {
  const msg = error?.message || String(error)
  if (/timeout|ETIMEDOUT/i.test(msg)) {
    return 'انتهت مهلة الاتصال — تحقق من الدومين الخارجي والمنفذ'
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(msg)) {
    return 'تعذر الوصول للراوتر — تحقق من الدومين الخارجي hslink.pro والمنفذ 7227'
  }
  if (/invalid user name or password|cannot log in|authentication/i.test(msg)) {
    return 'اسم المستخدم أو كلمة المرور غير صحيحة'
  }
  return msg
}

export async function getRouterStatus() {
  const cfg = getConnectionConfig()
  if (!cfg.host || !cfg.user || !cfg.password) {
    return {
      connected: false,
      host: formatHost(cfg),
      message: 'إعدادات الميكروتك غير مكتملة في ملف .env على السيرفر',
    }
  }

  try {
    return await withConnection(async (api, connection) => {
      const identityRows = await api.write('/system/identity/print')
      const resourceRows = await api.write('/system/resource/print')
      let hotspotUsers = 0
      try {
        const users = await api.write('/ip/hotspot/user/print')
        hotspotUsers = Array.isArray(users) ? users.length : 0
      } catch {
        hotspotUsers = 0
      }

      const identity = identityRows?.[0] || {}
      const resource = resourceRows?.[0] || {}

      return {
        connected: true,
        host: formatHost(connection),
        externalDomain: connection.host,
        port: connection.port,
        identity: identity.name || 'MikroTik',
        version: resource.version || '',
        boardName: resource['board-name'] || '',
        uptime: resource.uptime || '',
        hotspotUsers,
        cpuLoad: resource['cpu-load'] ?? null,
        message: `متصل — ${identity.name || connection.host}`,
      }
    })
  } catch (error) {
    console.error('[mikrotik]', error.message)
    return {
      connected: false,
      host: formatHost(cfg),
      externalDomain: cfg.host,
      port: cfg.port,
      message: mapConnectionError(error),
      error: error.message,
    }
  }
}

export async function getHotspotProfiles() {
  return withConnection(async (api) => {
    const profiles = await api.write('/ip/hotspot/user/profile/print')
    return (profiles || []).map((p) => ({
      id: p['.id'],
      name: p.name,
      rateLimit: p['rate-limit'] || '',
      sharedUsers: p['shared-users'] || '',
    }))
  })
}

export async function printHotspotUsers({ profiles, count, usernamePrefix = 'card' }) {
  const profileName = Array.isArray(profiles) ? profiles[0] : profiles
  if (!profileName || !count) {
    throw new Error('الفئة وعدد الكروت مطلوبان')
  }

  return withConnection(async (api) => {
    const codes = []
    const created = []

    for (let i = 0; i < count; i += 1) {
      const username = `${usernamePrefix}${Date.now()}${i}`
      const password = `${Math.random().toString(36).slice(2, 10)}`
      await api.write('/ip/hotspot/user/add', [
        `=name=${username}`,
        `=password=${password}`,
        `=profile=${profileName}`,
      ])
      codes.push({ username, password })
      created.push(username)
    }

    return {
      ok: true,
      printed: created.length,
      profile: profileName,
      codes,
    }
  })
}
