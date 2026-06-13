import { RouterOSAPI } from 'node-routeros'
import { query } from '../db/pool.js'
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

export async function syncRouterCardsCount(liveCount) {
  if (liveCount == null) {
    const status = await getRouterStatus()
    if (!status.connected) return { count: 0, synced: false }
    liveCount = status.hotspotUsers ?? 0
  }
  await query('UPDATE mikrotik_routers SET cards_printed = $1', [liveCount])
  return { count: liveCount, synced: true }
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
      let activeHotspotUsers = 0
      try {
        const users = await api.write('/ip/hotspot/user/print')
        hotspotUsers = Array.isArray(users) ? users.length : 0
      } catch {
        hotspotUsers = 0
      }
      try {
        const active = await api.write('/ip/hotspot/active/print')
        activeHotspotUsers = Array.isArray(active) ? active.length : 0
      } catch {
        activeHotspotUsers = 0
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
        activeHotspotUsers,
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
      sessionTimeout: p['session-timeout'] || '',
    }))
  })
}

function profileDuration(profile) {
  if (profile.sessionTimeout) return profile.sessionTimeout
  if (profile.sharedUsers && profile.sharedUsers !== '1') {
    return `${profile.sharedUsers} مستخدم مشترك`
  }
  return '24 ساعة'
}

function profileDataQuota(profile) {
  return profile.rateLimit || '1 جيجا'
}

export async function getHotspotUsers() {
  return withConnection(async (api) => {
    const users = await api.write('/ip/hotspot/user/print')
    return (users || []).map((u) => ({
      id: u['.id'],
      name: u.name || '',
      password: u.password || '',
      profile: u.profile || '',
      comment: u.comment || '',
      disabled: u.disabled === 'true',
    }))
  })
}

function inferCardCodeSettings(usernames) {
  const filtered = usernames.filter(
    (name) => name && name.length >= 3 && !/^(default|admin|trial|guest)/i.test(name)
  )
  if (!filtered.length) return null

  const perUser = filtered.map((name) => {
    let digits = 0
    let letters = 0
    for (const char of name) {
      if (/\d/.test(char)) digits += 1
      else if (/[a-zA-Z]/.test(char)) letters += 1
    }
    return { digits, letters }
  })

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
  }

  return {
    digits: Math.max(1, median(perUser.map((s) => s.digits))),
    chars: Math.max(0, median(perUser.map((s) => s.letters))),
    sampleCodes: filtered.slice(0, 5),
    analyzed: filtered.length,
  }
}

async function deleteManualCategories() {
  const { rows } = await query(
    `SELECT c.id FROM categories c
     LEFT JOIN batches b ON b.category_id = c.id
     WHERE c.router_profile IS NULL AND b.id IS NULL`
  )
  let deleted = 0
  for (const row of rows) {
    await query('DELETE FROM categories WHERE id = $1', [row.id])
    deleted += 1
  }
  return deleted
}

async function deleteStaleRouterCategories(profileNames) {
  if (!profileNames.length) {
    const { rows } = await query(
      `SELECT c.id FROM categories c
       LEFT JOIN batches b ON b.category_id = c.id
       WHERE c.router_profile IS NOT NULL AND b.id IS NULL`
    )
    let deleted = 0
    for (const row of rows) {
      await query('DELETE FROM categories WHERE id = $1', [row.id])
      deleted += 1
    }
    return deleted
  }

  const placeholders = profileNames.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await query(
    `SELECT c.id FROM categories c
     LEFT JOIN batches b ON b.category_id = c.id
     WHERE c.router_profile IS NOT NULL
       AND c.router_profile NOT IN (${placeholders})
       AND b.id IS NULL`,
    profileNames
  )
  let deleted = 0
  for (const row of rows) {
    await query('DELETE FROM categories WHERE id = $1', [row.id])
    deleted += 1
  }
  return deleted
}

export async function syncAllFromRouter() {
  const [profiles, hotspotUsers] = await Promise.all([
    getHotspotProfiles(),
    getHotspotUsers(),
  ])

  const deletedManual = await deleteManualCategories()
  const profileNames = profiles.map((p) => p.name)
  const deletedStale = await deleteStaleRouterCategories(profileNames)

  const categoryResults = []
  for (const profile of profiles) {
    const dataQuota = profileDataQuota(profile)
    const duration = profileDuration(profile)
    const { rows } = await query(
      'SELECT id FROM categories WHERE router_profile = $1 OR name = $2 LIMIT 1',
      [profile.name, profile.name]
    )

    if (rows[0]) {
      await query(
        `UPDATE categories
         SET name = $1, duration = $2, data_quota = $3, router_profile = $4
         WHERE id = $5`,
        [profile.name, duration, dataQuota, profile.name, rows[0].id]
      )
      categoryResults.push({ action: 'updated', name: profile.name })
    } else {
      await query(
        `INSERT INTO categories (name, price, duration, data_quota, router_profile)
         VALUES ($1, $2, $3, $4, $5)`,
        [profile.name, 0, duration, dataQuota, profile.name]
      )
      categoryResults.push({ action: 'created', name: profile.name })
    }
  }

  const inferred = inferCardCodeSettings(hotspotUsers.map((u) => u.name))
  let cardSettings = null
  if (inferred) {
    await query(
      `INSERT INTO card_settings (id, digits, chars) VALUES (1, $1, $2)
       ON DUPLICATE KEY UPDATE digits = VALUES(digits), chars = VALUES(chars)`,
      [inferred.digits, inferred.chars]
    )
    cardSettings = inferred
  }

  await syncRouterCardsCount(hotspotUsers.length)

  return {
    categories: {
      synced: categoryResults.length,
      deletedManual,
      deletedStale,
      profiles: categoryResults,
    },
    cardSettings,
    hotspotUsers: hotspotUsers.length,
    usersSample: hotspotUsers.slice(0, 10).map((u) => ({
      name: u.name,
      profile: u.profile,
    })),
  }
}

/** @deprecated use syncAllFromRouter */
export async function syncCategoriesFromRouter() {
  const result = await syncAllFromRouter()
  return {
    synced: result.categories.synced,
    profiles: result.categories.profiles,
    deletedManual: result.categories.deletedManual,
    cardSettings: result.cardSettings,
  }
}

export async function pushHotspotUsers({ profile, codes }) {
  const profileName = profile
  if (!profileName || !codes?.length) {
    throw new Error('بروفايل الراوتر والأكواد مطلوبان')
  }

  return withConnection(async (api) => {
    for (const code of codes) {
      let added = false
      for (let attempt = 0; attempt < 5 && !added; attempt += 1) {
        try {
          await api.write('/ip/hotspot/user/add', [
            `=name=${code}`,
            `=password=${code}`,
            `=profile=${profileName}`,
          ])
          added = true
        } catch (error) {
          if (attempt === 4) throw error
        }
      }
    }

    const users = await api.write('/ip/hotspot/user/print')
    const liveCount = Array.isArray(users) ? users.length : codes.length
    await query('UPDATE mikrotik_routers SET cards_printed = $1', [liveCount])

    return { added: codes.length, totalOnRouter: liveCount }
  })
}
