import { RouterOSAPI } from 'node-routeros'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import {
  ROUTER_SOURCE,
  normalizeRouterSource,
  routerSourceLabel,
  routerSourceLabelAr,
} from '../constants/routerSource.js'
import { formatDurationLabel, parseRosTime, parseTimeHms, parseValidityPeriod } from '../utils/duration.js'

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
    timeout: 25,
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

/** عدّ سريع بدون جلب كل السجلات — للمراقبة فقط */
async function printCount(api, path) {
  try {
    const rows = await api.write(path, ['=count-only='])
    if (!rows?.length) return 0
    const row = rows[0]
    if (row.ret !== undefined && row.ret !== null && row.ret !== '') {
      return Number(row.ret) || 0
    }
    return 0
  } catch {
    return 0
  }
}

async function fetchUserManagerStatusLite(api) {
  try {
    const [userManagerUsers, activeUserManagerSessions, umProfiles, customersRaw] = await Promise.all([
      printCount(api, '/tool/user-manager/user/print'),
      printCount(api, '/tool/user-manager/session/print'),
      printCount(api, '/tool/user-manager/profile/print'),
      api.write('/tool/user-manager/customer/print').catch(() => []),
    ])

    const customers = (customersRaw || []).map(mapUserManagerCustomerRow)
    const defaultCustomer = pickDefaultUserManagerCustomer(customers, [])

    return {
      userManagerUsers,
      activeUserManagerSessions,
      userManager: {
        available: userManagerUsers > 0 || customers.length > 0 || umProfiles > 0,
        customers: customers.map((c) => ({
          login: customerLogin(c),
          name: c.name,
        })),
        defaultCustomer,
        profiles: umProfiles,
      },
    }
  } catch {
    return {
      userManagerUsers: 0,
      activeUserManagerSessions: 0,
      userManager: {
        available: false,
        customers: [],
        defaultCustomer: null,
        profiles: 0,
      },
    }
  }
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

      const [hotspotUsers, activeHotspotUsers, umLite] = await Promise.all([
        printCount(api, '/ip/hotspot/user/print'),
        printCount(api, '/ip/hotspot/active/print'),
        fetchUserManagerStatusLite(api),
      ])

      const { userManagerUsers, activeUserManagerSessions, userManager } = umLite

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
        userManagerUsers,
        activeUserManagerSessions,
        userManager,
        totalCards: hotspotUsers + userManagerUsers,
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

function profileDurationParts(profile) {
  const session = parseTimeHms(profile.sessionTimeout)
  if (session) {
    return {
      durationHours: session.hours,
      durationMinutes: session.minutes,
      duration: formatDurationLabel(session.hours, session.minutes),
    }
  }
  return { durationHours: 24, durationMinutes: 0, duration: '24 ساعة' }
}

function profileDataQuota(profile) {
  return profile.rateLimit || '1 جيجا'
}

export async function getHotspotUsers() {
  return withConnection(async (api) => {
    const users = await api.write('/ip/hotspot/user/print')
    return (users || []).map((u) => mapHotspotUserRow(u))
  })
}

function mapHotspotUserRow(u) {
  return {
    id: u['.id'],
    name: u.name || '',
    password: u.password || '',
    profile: u.profile || '',
    comment: u.comment || '',
    disabled: u.disabled === 'true',
    uptime: u.uptime || '',
    limitUptime: u['limit-uptime'] || '',
    limitBytesIn: u['limit-bytes-in'] || '',
    limitBytesOut: u['limit-bytes-out'] || '',
    bytesIn: u['bytes-in'] || '',
    bytesOut: u['bytes-out'] || '',
  }
}

function hasCardUsage(user) {
  const uptime = user.uptime || ''
  const bytesIn = Number(user.bytesIn || 0)
  const bytesOut = Number(user.bytesOut || 0)
  return Boolean(uptime && uptime !== '0s') || bytesIn > 0 || bytesOut > 0
}

function resolveCardStatus(user, activeUsernames, usageCheck = hasCardUsage) {
  if (user.disabled) {
    return { status: 'disabled', label: 'معطّل' }
  }
  if (activeUsernames.has(user.name)) {
    return { status: 'connected', label: 'متصل الآن' }
  }
  if (usageCheck(user)) {
    return { status: 'expired', label: 'منتهي' }
  }
  return { status: 'available', label: 'نشط' }
}

export async function getHotspotInventory() {
  return withConnection(async (api) => {
    const [users, activeSessions] = await Promise.all([
      api.write('/ip/hotspot/user/print'),
      api.write('/ip/hotspot/active/print').catch(() => []),
    ])

    const activeUsernames = new Set(
      (activeSessions || []).map((s) => s.user).filter(Boolean)
    )

    const cards = (users || []).map((u) => {
      const row = mapHotspotUserRow(u)
      const { status, label } = resolveCardStatus(row, activeUsernames)
      const activeSession = (activeSessions || []).find((s) => s.user === row.name)
      return {
        ...row,
        status,
        statusLabel: label,
        connectedIp: activeSession?.address || '',
        sessionUptime: activeSession?.uptime || '',
        source: ROUTER_SOURCE.HOTSPOT,
        sourceLabel: routerSourceLabel(ROUTER_SOURCE.HOTSPOT),
        sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.HOTSPOT),
      }
    })

    cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const summary = {
      total: cards.length,
      available: cards.filter((c) => c.status === 'available').length,
      connected: cards.filter((c) => c.status === 'connected').length,
      expired: cards.filter((c) => c.status === 'expired').length,
      disabled: cards.filter((c) => c.status === 'disabled').length,
    }

    return {
      cards,
      summary,
      fetchedAt: new Date().toISOString(),
    }
  })
}

function isUserManagerUnavailable(error) {
  const msg = error?.message || String(error)
  return /no such command|bad command|cannot find|not implemented|user manager is not/i.test(msg)
}

function mapUserManagerCustomerRow(c) {
  return {
    id: c['.id'],
    login: c.login || '',
    name: c.name || c.login || '',
    disabled: c.disabled === 'true',
  }
}

function customerLogin(customer) {
  return customer.login || customer.name || ''
}

function pickDefaultUserManagerCustomer(customers, users = []) {
  if (!customers.length) return null

  if (users.length) {
    const counts = {}
    for (const user of users) {
      const key = user.customer
      if (key) counts[key] = (counts[key] || 0) + 1
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    if (top?.[0]) return top[0]
  }

  const admin = customers.find((c) => customerLogin(c).toLowerCase() === 'admin')
  if (admin) return customerLogin(admin)

  return customerLogin(customers[0])
}

async function fetchUserManagerSnapshot(api) {
  const [customersRaw, usersRaw, profilesRaw, sessionsRaw] = await Promise.all([
    api.write('/tool/user-manager/customer/print').catch(() => []),
    api.write('/tool/user-manager/user/print').catch(() => []),
    api.write('/tool/user-manager/profile/print').catch(() => []),
    api.write('/tool/user-manager/session/print').catch(() => []),
  ])

  const limitsByProfile = await fetchUserManagerLimitationData(api, profilesRaw)

  const customers = (customersRaw || []).map(mapUserManagerCustomerRow)
  const users = (usersRaw || []).map(mapUserManagerUserRow)
  const profiles = (profilesRaw || []).map((p) => mapUserManagerProfileRow(p, limitsByProfile[p.name]))
  const defaultCustomer = pickDefaultUserManagerCustomer(customers, users)

  return {
    customers,
    users,
    profiles,
    sessions: sessionsRaw || [],
    defaultCustomer,
  }
}

function buildProfileIdMap(profilesRaw) {
  const idToName = {}
  for (const p of profilesRaw || []) {
    if (p.name) idToName[p.name] = p.name
    if (p['.id']) idToName[p['.id']] = p.name
  }
  return idToName
}

async function probeRouterPath(api, path) {
  try {
    const rows = await api.write(path)
    const list = Array.isArray(rows) ? rows : []
    return { path, ok: true, count: list.length, rows: list, error: null }
  } catch (error) {
    return { path, ok: false, count: 0, rows: [], error: error.message || String(error) }
  }
}

async function pickBestRouterPath(api, paths) {
  const probes = await Promise.all(paths.map((path) => probeRouterPath(api, path)))
  const viable = probes.filter((p) => p.ok).sort((a, b) => b.count - a.count)
  return {
    probes,
    best: viable[0] || null,
    rows: viable[0]?.rows || [],
  }
}

const UM_PROFILE_LINK_PATHS = [
  '/tool/user-manager/profile/profile-limitation/print',
]

// RouterOS 6.x stores limitation defs under profile/limitation; v7 may use /limitation
const UM_LIMITATION_DEF_PATHS = [
  '/tool/user-manager/profile/limitation/print',
  '/tool/user-manager/limitation/print',
]

function scoreLimitationDefRows(rows) {
  if (!rows?.length) return 0
  const withUptime = rows.filter(
    (row) => row['uptime-limit'] && row['uptime-limit'] !== '00:00:00'
  ).length
  return withUptime > 0 ? 1000 + withUptime : rows.length
}

async function pickBestLimitationDefPath(api, paths) {
  const probes = await Promise.all(paths.map((path) => probeRouterPath(api, path)))
  const viable = probes
    .filter((p) => p.ok)
    .sort((a, b) => scoreLimitationDefRows(b.rows) - scoreLimitationDefRows(a.rows))
  return {
    probes,
    best: viable[0] || null,
    rows: viable[0]?.rows || [],
  }
}

async function fetchUptimeLimitsFromUsers(api, profilesRaw) {
  const idToName = buildProfileIdMap(profilesRaw)
  const byProfile = {}

  const userSources = await Promise.all([
    probeRouterPath(api, '/tool/user-manager/user/print'),
    probeRouterPath(api, '/tool/user-manager/user-profile/print'),
  ])

  for (const source of userSources) {
    for (const row of source.rows) {
      const profKey = row['actual-profile'] || row.profile
      const profileName = idToName[profKey] || profKey
      const uptime = row['uptime-limit']
      if (profileName && uptime && uptime !== '00:00:00' && !byProfile[profileName]) {
        byProfile[profileName] = uptime
      }
    }
  }

  return { byProfile, userSources: userSources.map(({ path, ok, count, error }) => ({ path, ok, count, error })) }
}

function buildLimitationLookup(limitationDefsRaw) {
  const byKey = {}
  for (const lim of limitationDefsRaw || []) {
    if (lim.name) byKey[lim.name] = lim
    if (lim['.id']) byKey[lim['.id']] = lim
  }
  return byKey
}

function pickLimitValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '' && value !== '0' && value !== '00:00:00') {
      return value
    }
  }
  return ''
}

function mergeLimitRows(existing, next) {
  return {
    'uptime-limit': pickLimitValue(existing?.['uptime-limit'], next?.['uptime-limit']),
    'download-limit': pickLimitValue(existing?.['download-limit'], next?.['download-limit']),
    'upload-limit': pickLimitValue(existing?.['upload-limit'], next?.['upload-limit']),
    'transfer-limit': pickLimitValue(existing?.['transfer-limit'], next?.['transfer-limit']),
  }
}

function formatBytesQuota(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 1073741824) {
    const gb = n / 1073741824
    return Number.isInteger(gb) ? `${gb} جيجابايت` : `${gb.toFixed(2)} جيجابايت`
  }
  if (n >= 1048576) return `${Math.round(n / 1048576)} ميجابايت`
  return `${n} بايت`
}

function resolveProfileLimitations(profileLinksRaw, limitationDefsRaw, profilesRaw) {
  const limitationByKey = buildLimitationLookup(limitationDefsRaw)
  const idToName = buildProfileIdMap(profilesRaw)

  const limitsByProfile = {}
  for (const link of profileLinksRaw || []) {
    const profileName = idToName[link.profile] || link.profile
    if (!profileName) continue

    const limKey = link.limitation
    const limDef = limitationByKey[limKey] || limitationByKey[idToName[limKey]] || link
    limitsByProfile[profileName] = mergeLimitRows(limitsByProfile[profileName], limDef)
  }
  return limitsByProfile
}

function applyUptimeFallback(limitsByProfile, uptimeByProfile) {
  for (const [profileName, uptime] of Object.entries(uptimeByProfile || {})) {
    if (!limitsByProfile[profileName]?.['uptime-limit']) {
      limitsByProfile[profileName] = mergeLimitRows(limitsByProfile[profileName], {
        'uptime-limit': uptime,
      })
    }
  }
  return limitsByProfile
}

async function fetchUserManagerLimitationBundle(api, profilesRaw) {
  const [profileLinkPick, limitationPick, userFallback] = await Promise.all([
    pickBestRouterPath(api, UM_PROFILE_LINK_PATHS),
    pickBestLimitationDefPath(api, UM_LIMITATION_DEF_PATHS),
    fetchUptimeLimitsFromUsers(api, profilesRaw),
  ])

  let limitsByProfile = resolveProfileLimitations(
    profileLinkPick.rows,
    limitationPick.rows,
    profilesRaw
  )
  applyUptimeFallback(limitsByProfile, userFallback.byProfile)

  return {
    limitsByProfile,
    limitationPick,
    profileLinkPick,
    userFallback,
  }
}

async function fetchUserManagerLimitationData(api, profilesRaw) {
  const bundle = await fetchUserManagerLimitationBundle(api, profilesRaw)
  return bundle.limitsByProfile
}

export async function diagnoseUserManagerLimits() {
  return withConnection(async (api) => {
    const profilesRaw = await api.write('/tool/user-manager/profile/print').catch((error) => {
      throw new Error(`تعذر قراءة البروفايلات: ${error.message}`)
    })

    const bundle = await fetchUserManagerLimitationBundle(api, profilesRaw)
    const { rows: dbCategories } = await query(
      `SELECT name, router_profile AS routerProfile, router_source AS routerSource,
              duration_hours AS durationHours, duration_minutes AS durationMinutes, duration
       FROM categories WHERE router_source = 'user-manager' ORDER BY id`
    )

    const profiles = (profilesRaw || []).map((p) => {
      const limitation = bundle.limitsByProfile[p.name] || {}
      const mapped = mapUserManagerProfileRow(p, limitation)
      const parsed = umProfileDurationParts(mapped)
      const issues = []
      if (!mapped.uptimeLimit) issues.push('uptime-limit فارغ من الراوتر')
      if (!parsed.durationHours && !parsed.durationMinutes) issues.push('لم يُحلّل وقت الاستخدام')
      return {
        name: mapped.name,
        validity: mapped.validity,
        price: mapped.price,
        uptimeLimitRaw: mapped.uptimeLimit || null,
        downloadLimitRaw: mapped.downloadLimit || null,
        durationHours: parsed.durationHours,
        durationMinutes: parsed.durationMinutes,
        validityLabel: parsed.duration,
        issues,
      }
    })

    const globalIssues = []
    if (!bundle.limitationPick.best) {
      globalIssues.push('فشل جلب جدول limitation — تحقق من صلاحيات API')
    } else if (bundle.limitationPick.best.count === 0) {
      globalIssues.push('جدول limitation فارغ على الراوتر')
    }
    if (!bundle.profileLinkPick.best) {
      globalIssues.push('فشل جلب profile-limitation — المسار غير مدعوم أو لا صلاحية')
    } else if (bundle.profileLinkPick.best.count === 0) {
      globalIssues.push('لا توجد روابط profile-limitation — الوقت لن يُقرأ من limitation')
    }
    if (profiles.every((p) => p.issues.length > 0) && Object.keys(bundle.userFallback.byProfile).length === 0) {
      globalIssues.push('لا يوجد uptime-limit في limitation ولا في users كبديل')
    }

    return {
      ok: profiles.some((p) => !p.issues.length),
      summary: {
        profiles: profiles.length,
        limitations: bundle.limitationPick.best?.count ?? 0,
        profileLinks: bundle.profileLinkPick.best?.count ?? 0,
        uptimeFromUsers: Object.keys(bundle.userFallback.byProfile).length,
        categoriesInDb: dbCategories.length,
      },
      globalIssues,
      apiPaths: {
        limitations: bundle.limitationPick.probes,
        profileLinks: bundle.profileLinkPick.probes,
        users: bundle.userFallback.userSources,
      },
      winningPaths: {
        limitations: bundle.limitationPick.best?.path || null,
        profileLinks: bundle.profileLinkPick.best?.path || null,
      },
      limitationDefsSample: (bundle.limitationPick.rows || []).slice(0, 5),
      profileLinksSample: (bundle.profileLinkPick.rows || []).slice(0, 5),
      uptimeFromUsers: bundle.userFallback.byProfile,
      profiles,
      dbCategories,
    }
  })
}

function mapUserManagerProfileRow(p, limitation) {
  return {
    id: p['.id'],
    name: p.name,
    validity: p.validity || '',
    price: p.price ?? '',
    owner: p.owner || '',
    nameForUsers: p['name-for-users'] || '',
    uptimeLimit: limitation?.['uptime-limit'] || p['uptime-limit'] || '',
    downloadLimit: limitation?.['download-limit'] || p['download-limit'] || '',
    transferLimit: limitation?.['transfer-limit'] || p['transfer-limit'] || '',
  }
}

async function fetchUserManagerForCategorySync(api) {
  const [customersRaw, profilesRaw] = await Promise.all([
    api.write('/tool/user-manager/customer/print').catch(() => []),
    api.write('/tool/user-manager/profile/print').catch(() => []),
  ])

  const limitsByProfile = await fetchUserManagerLimitationData(api, profilesRaw)

  const customers = (customersRaw || []).map(mapUserManagerCustomerRow)
  const profiles = (profilesRaw || []).map((p) => mapUserManagerProfileRow(p, limitsByProfile[p.name]))
  const defaultCustomer = pickDefaultUserManagerCustomer(customers, [])

  return { customers, profiles, defaultCustomer }
}

export async function fetchUserManagerProfilesOnly() {
  return withConnection(async (api) => fetchUserManagerForCategorySync(api))
}

export async function fetchUserManagerFromRouter() {
  return withConnection(async (api) => fetchUserManagerSnapshot(api))
}

export async function getUserManagerCustomers() {
  const snapshot = await fetchUserManagerFromRouter()
  return {
    customers: snapshot.customers,
    defaultCustomer: snapshot.defaultCustomer,
  }
}

async function resolveUserManagerCustomer(api, explicitCustomer) {
  if (explicitCustomer) return explicitCustomer
  if (env.mikrotik.userManagerCustomerOverride) {
    return env.mikrotik.userManagerCustomerOverride
  }

  const snapshot = await fetchUserManagerSnapshot(api)
  if (!snapshot.defaultCustomer) {
    throw new Error('لا يوجد عميل User Manager على الراوتر — فعّل User Manager أو أضف customer')
  }
  return snapshot.defaultCustomer
}

export async function getUserManagerProfiles() {
  return withConnection(async (api) => {
    const profilesRaw = await api.write('/tool/user-manager/profile/print')
    const limitsByProfile = await fetchUserManagerLimitationData(api, profilesRaw)
    return (profilesRaw || []).map((p) => mapUserManagerProfileRow(p, limitsByProfile[p.name]))
  })
}

function umProfileDurationParts(profile) {
  const validity = parseValidityPeriod(profile.validity)
  const uptime = parseRosTime(profile.uptimeLimit)
  return {
    durationHours: uptime?.hours ?? 0,
    durationMinutes: uptime?.minutes ?? 0,
    duration: formatDurationLabel(validity.hours, validity.minutes),
  }
}

function umProfileDataQuota(profile) {
  if (profile.downloadLimit && profile.downloadLimit !== '0') return profile.downloadLimit
  const transfer = formatBytesQuota(profile.transferLimit)
  if (transfer) return transfer
  if (profile.nameForUsers) return profile.nameForUsers
  return '1 جيجا'
}

function umProfilePrice(profile) {
  const price = Number(String(profile.price ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(price) ? price : 0
}

export async function getUserManagerUsers() {
  return withConnection(async (api) => {
    const users = await api.write('/tool/user-manager/user/print')
    return (users || []).map((u) => mapUserManagerUserRow(u))
  })
}

function mapUserManagerUserRow(u) {
  return {
    id: u['.id'],
    name: u.username || u.name || '',
    password: u.password || '',
    profile: u['actual-profile'] || u.profile || '',
    comment: u.comment || u.location || '',
    disabled: u.disabled === 'true',
    uptime: u['uptime-used'] || '',
    limitUptime: u['uptime-limit'] || '',
    bytesIn: u['download-used'] || '',
    bytesOut: u['upload-used'] || '',
    customer: u.customer || '',
  }
}

function hasUserManagerUsage(user) {
  const uptime = user.uptime || ''
  const bytesIn = Number(user.bytesIn || 0)
  const bytesOut = Number(user.bytesOut || 0)
  return Boolean(uptime && uptime !== '0s') || bytesIn > 0 || bytesOut > 0
}

export async function getUserManagerInventory() {
  return withConnection(async (api) => {
    const um = await fetchUserManagerSnapshot(api)

    const activeUsernames = new Set(
      um.sessions.map((s) => s.user || s.username).filter(Boolean)
    )

    const cards = um.users.map((row) => {
      const { status, label } = resolveCardStatus(row, activeUsernames, hasUserManagerUsage)
      const activeSession = um.sessions.find(
        (s) => (s.user || s.username) === row.name
      )
      return {
        ...row,
        status,
        statusLabel: label,
        connectedIp: activeSession?.['ip-address'] || activeSession?.address || '',
        sessionUptime: activeSession?.uptime || '',
        source: ROUTER_SOURCE.USER_MANAGER,
        sourceLabel: routerSourceLabel(ROUTER_SOURCE.USER_MANAGER),
        sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.USER_MANAGER),
      }
    })

    cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

    const summary = {
      total: cards.length,
      available: cards.filter((c) => c.status === 'available').length,
      connected: cards.filter((c) => c.status === 'connected').length,
      expired: cards.filter((c) => c.status === 'expired').length,
      disabled: cards.filter((c) => c.status === 'disabled').length,
    }

    return {
      cards,
      summary,
      userManager: {
        available: true,
        customers: um.customers.map((c) => ({
          login: customerLogin(c),
          name: c.name,
        })),
        defaultCustomer: um.defaultCustomer,
        profiles: um.profiles.length,
      },
      fetchedAt: new Date().toISOString(),
    }
  })
}

function normalizeInventoryPeriod(period) {
  if (period === 'day' || period === 'month') return period
  return 'week'
}

function periodLabelAr(period) {
  if (period === 'day') return 'اليوم'
  if (period === 'month') return 'آخر 30 يوم'
  return 'آخر 7 أيام'
}

function periodSqlWhere(period) {
  if (period === 'day') return 'b.printed_at >= CURDATE()'
  if (period === 'month') return 'b.printed_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)'
  return 'b.printed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)'
}

async function getPrintedCardsForPeriod(period) {
  const normalized = normalizeInventoryPeriod(period)
  const { rows } = await query(
    `SELECT c.code, c.status AS dbStatus, b.category_name AS categoryName,
            b.printed_at AS printedAt, b.router_source AS routerSource,
            COALESCE(cat.router_profile, b.category_name) AS profile
     FROM cards c
     INNER JOIN batches b ON b.id = c.batch_id
     LEFT JOIN categories cat ON cat.id = b.category_id
     WHERE ${periodSqlWhere(normalized)}
     ORDER BY b.printed_at DESC, c.id DESC
     LIMIT 10000`
  )
  return { rows, period: normalized, truncated: rows.length >= 10000 }
}

async function fetchHotspotUsersIndexed(api, codeSet) {
  const activeSessions = await api.write('/ip/hotspot/active/print').catch(() => [])
  const activeUsernames = new Set(
    (activeSessions || []).map((s) => s.user).filter(Boolean)
  )

  const byName = new Map()
  const proplist = ['=.proplist=name,profile,comment,disabled,uptime,bytes-in,bytes-out']

  if (codeSet.size > 0 && codeSet.size <= 400) {
    const codes = [...codeSet]
    const batchSize = 30
    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize)
      await Promise.all(batch.map(async (code) => {
        try {
          const rows = await api.write('/ip/hotspot/user/print', [`?name=${code}`, ...proplist])
          if (rows?.[0]?.name) byName.set(rows[0].name, mapHotspotUserRow(rows[0]))
        } catch {
          // skip missing
        }
      }))
    }
  } else if (codeSet.size > 400) {
    const usersRaw = await api.write('/ip/hotspot/user/print', proplist)
    for (const u of usersRaw || []) {
      if (u.name && codeSet.has(u.name)) byName.set(u.name, mapHotspotUserRow(u))
    }
  }

  return { byName, activeUsernames, activeSessions: activeSessions || [] }
}

async function fetchUserManagerUsersIndexed(api, codeSet) {
  const sessions = await api.write('/tool/user-manager/session/print').catch(() => [])
  const activeUsernames = new Set(
    (sessions || []).map((s) => s.user || s.username).filter(Boolean)
  )

  const byName = new Map()

  if (codeSet.size > 0 && codeSet.size <= 400) {
    const codes = [...codeSet]
    const batchSize = 30
    for (let i = 0; i < codes.length; i += batchSize) {
      await Promise.all(codes.slice(i, i + batchSize).map(async (code) => {
        for (const queryWord of [`?username=${code}`, `?name=${code}`]) {
          try {
            const rows = await api.write('/tool/user-manager/user/print', [queryWord])
            const row = rows?.find((r) => (r.username || r.name) === code)
            if (row) {
              byName.set(code, mapUserManagerUserRow(row))
              break
            }
          } catch {
            // try next query field
          }
        }
      }))
    }
  } else if (codeSet.size > 400) {
    const usersRaw = await api.write('/tool/user-manager/user/print')
    for (const u of usersRaw || []) {
      const name = u.username || u.name
      if (name && codeSet.has(name)) byName.set(name, mapUserManagerUserRow(u))
    }
  }

  return { byName, activeUsernames, sessions: sessions || [] }
}

function buildHotspotInventoryCard(row, activeUsernames, activeSessions) {
  const { status, label } = resolveCardStatus(row, activeUsernames)
  const activeSession = activeSessions.find((s) => s.user === row.name)
  return {
    ...row,
    status,
    statusLabel: label,
    connectedIp: activeSession?.address || '',
    sessionUptime: activeSession?.uptime || '',
    source: ROUTER_SOURCE.HOTSPOT,
    sourceLabel: routerSourceLabel(ROUTER_SOURCE.HOTSPOT),
    sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.HOTSPOT),
  }
}

function buildUserManagerInventoryCard(row, activeUsernames, sessions) {
  const { status, label } = resolveCardStatus(row, activeUsernames, hasUserManagerUsage)
  const activeSession = sessions.find((s) => (s.user || s.username) === row.name)
  return {
    ...row,
    status,
    statusLabel: label,
    connectedIp: activeSession?.['ip-address'] || activeSession?.address || '',
    sessionUptime: activeSession?.uptime || '',
    source: ROUTER_SOURCE.USER_MANAGER,
    sourceLabel: routerSourceLabel(ROUTER_SOURCE.USER_MANAGER),
    sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.USER_MANAGER),
  }
}

function buildMissingInventoryCard(dbRow) {
  const source = normalizeRouterSource(dbRow.routerSource)
  return {
    id: dbRow.code,
    name: dbRow.code,
    profile: dbRow.profile || dbRow.categoryName,
    comment: dbRow.categoryName,
    disabled: false,
    uptime: '',
    status: 'missing',
    statusLabel: 'غير على الراوتر',
    connectedIp: '',
    sessionUptime: '',
    printedAt: dbRow.printedAt,
    dbStatus: dbRow.dbStatus,
    source,
    sourceLabel: routerSourceLabel(source),
    sourceLabelAr: routerSourceLabelAr(source),
  }
}

export async function getCombinedInventory(options = {}) {
  const period = normalizeInventoryPeriod(options.period)
  const { rows: dbRows, truncated } = await getPrintedCardsForPeriod(period)

  if (!dbRows.length) {
    return {
      cards: [],
      summary: {
        total: 0,
        available: 0,
        connected: 0,
        expired: 0,
        disabled: 0,
        missing: 0,
        hotspot: 0,
        userManager: 0,
      },
      period,
      periodLabel: periodLabelAr(period),
      truncated: false,
      sources: { hotspot: false, userManager: false },
      userManager: { available: false, customers: [], defaultCustomer: null, profiles: 0 },
      fetchedAt: new Date().toISOString(),
    }
  }

  const codeSet = new Set(dbRows.map((r) => r.code))
  const codesBySource = { hotspot: new Set(), 'user-manager': new Set() }
  for (const row of dbRows) {
    const source = normalizeRouterSource(row.routerSource)
    codesBySource[source === ROUTER_SOURCE.USER_MANAGER ? 'user-manager' : 'hotspot'].add(row.code)
  }

  let hotspotIndex = { byName: new Map(), activeUsernames: new Set(), activeSessions: [] }
  let umIndex = { byName: new Map(), activeUsernames: new Set(), sessions: [] }
  let userManagerAvailable = true
  let hotspotOk = false
  let umOk = false

  try {
    await withConnection(async (api) => {
      if (codesBySource.hotspot.size > 0) {
        hotspotIndex = await fetchHotspotUsersIndexed(api, codesBySource.hotspot)
        hotspotOk = true
      }
      if (codesBySource['user-manager'].size > 0) {
        try {
          umIndex = await fetchUserManagerUsersIndexed(api, codesBySource['user-manager'])
          umOk = true
        } catch (error) {
          if (isUserManagerUnavailable(error)) userManagerAvailable = false
          else throw error
        }
      }
    })
  } catch (error) {
    console.warn('[mikrotik] inventory period fetch failed:', error.message)
    throw error
  }

  const cards = dbRows.map((dbRow) => {
    const source = normalizeRouterSource(dbRow.routerSource)
    const cardWithDate = { printedAt: dbRow.printedAt, dbStatus: dbRow.dbStatus }

    if (source === ROUTER_SOURCE.USER_MANAGER) {
      const row = umIndex.byName.get(dbRow.code)
      if (!row) return { ...buildMissingInventoryCard(dbRow), ...cardWithDate }
      return { ...buildUserManagerInventoryCard(row, umIndex.activeUsernames, umIndex.sessions), ...cardWithDate }
    }

    const row = hotspotIndex.byName.get(dbRow.code)
    if (!row) return { ...buildMissingInventoryCard(dbRow), ...cardWithDate }
    return {
      ...buildHotspotInventoryCard(row, hotspotIndex.activeUsernames, hotspotIndex.activeSessions),
      ...cardWithDate,
    }
  })

  cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const summary = {
    total: cards.length,
    available: cards.filter((c) => c.status === 'available').length,
    connected: cards.filter((c) => c.status === 'connected').length,
    expired: cards.filter((c) => c.status === 'expired').length,
    disabled: cards.filter((c) => c.status === 'disabled').length,
    missing: cards.filter((c) => c.status === 'missing').length,
    hotspot: cards.filter((c) => c.source === ROUTER_SOURCE.HOTSPOT).length,
    userManager: cards.filter((c) => c.source === ROUTER_SOURCE.USER_MANAGER).length,
  }

  return {
    cards,
    summary,
    period,
    periodLabel: periodLabelAr(period),
    truncated,
    sources: {
      hotspot: hotspotOk || codesBySource.hotspot.size === 0,
      userManager: userManagerAvailable && (umOk || codesBySource['user-manager'].size === 0),
    },
    userManager: {
      available: userManagerAvailable,
      customers: [],
      defaultCustomer: null,
      profiles: 0,
    },
    fetchedAt: new Date().toISOString(),
  }
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

async function deleteStaleRouterCategories(profileNames, source = ROUTER_SOURCE.HOTSPOT) {
  const normalizedSource = normalizeRouterSource(source)

  if (!profileNames.length) {
    const { rows } = await query(
      `SELECT c.id FROM categories c
       LEFT JOIN batches b ON b.category_id = c.id
       WHERE c.router_profile IS NOT NULL
         AND c.router_source = $1
         AND b.id IS NULL`,
      [normalizedSource]
    )
    let deleted = 0
    for (const row of rows) {
      await query('DELETE FROM categories WHERE id = $1', [row.id])
      deleted += 1
    }
    return deleted
  }

  const placeholders = profileNames.map((_, i) => `$${i + 2}`).join(', ')
  const { rows } = await query(
    `SELECT c.id FROM categories c
     LEFT JOIN batches b ON b.category_id = c.id
     WHERE c.router_profile IS NOT NULL
       AND c.router_source = $1
       AND c.router_profile NOT IN (${placeholders})
       AND b.id IS NULL`,
    [normalizedSource, ...profileNames]
  )
  let deleted = 0
  for (const row of rows) {
    await query('DELETE FROM categories WHERE id = $1', [row.id])
    deleted += 1
  }
  return deleted
}

async function upsertCategoryFromProfile({
  name, duration, durationHours, durationMinutes, dataQuota, source, price,
}) {
  const normalizedSource = normalizeRouterSource(source)
  const durHours = durationHours ?? 24
  const durMinutes = durationMinutes ?? 0
  const durLabel = duration || formatDurationLabel(durHours, durMinutes)
  const categoryPrice = Number(price) || 0

  let { rows } = await query(
    'SELECT id FROM categories WHERE router_profile = $1 AND router_source = $2 LIMIT 1',
    [name, normalizedSource]
  )

  if (!rows[0] && normalizedSource === ROUTER_SOURCE.USER_MANAGER) {
    const fallback = await query(
      'SELECT id FROM categories WHERE router_profile = $1 LIMIT 1',
      [name]
    )
    rows = fallback.rows
  }

  if (rows[0]) {
    await query(
      `UPDATE categories
       SET name = $1, price = $2, duration = $3, duration_hours = $4, duration_minutes = $5,
           data_quota = $6, router_profile = $7, router_source = $8
       WHERE id = $9`,
      [name, categoryPrice, durLabel, durHours, durMinutes, dataQuota, name, normalizedSource, rows[0].id]
    )
    return { action: 'updated', name, source: normalizedSource }
  }

  await query(
    `INSERT INTO categories
      (name, price, duration, duration_hours, duration_minutes, data_quota, router_profile, router_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [name, categoryPrice, durLabel, durHours, durMinutes, dataQuota, name, normalizedSource]
  )
  return { action: 'created', name, source: normalizedSource }
}

async function fixMislabeledUserManagerCategories(umProfileNames) {
  if (!umProfileNames.length) return 0

  const placeholders = umProfileNames.map((_, i) => `$${i + 1}`).join(', ')
  const { affectedRows } = await query(
    `UPDATE categories SET router_source = 'user-manager'
     WHERE router_source = 'hotspot' AND router_profile IN (${placeholders})`,
    umProfileNames
  )
  return affectedRows || 0
}

async function deleteDuplicateHotspotCategories(umProfileNames) {
  if (!umProfileNames.length) return 0

  let deleted = 0
  for (const name of umProfileNames) {
    const { rows } = await query(
      `SELECT c.id FROM categories c
       INNER JOIN categories um ON um.router_profile = c.router_profile
         AND um.router_source = 'user-manager'
       LEFT JOIN batches b ON b.category_id = c.id
       WHERE c.router_profile = $1 AND c.router_source = 'hotspot' AND b.id IS NULL`,
      [name]
    )
    for (const row of rows) {
      await query('DELETE FROM categories WHERE id = $1', [row.id])
      deleted += 1
    }
  }
  return deleted
}

export async function syncAllFromRouter() {
  const profiles = await getHotspotProfiles()

  let umProfiles = []
  let umCustomers = []
  let umDefaultCustomer = null
  let userManagerAvailable = true
  let hotspotUsersCount = 0
  let umUsersCount = 0

  try {
    const um = await fetchUserManagerProfilesOnly()
    umProfiles = um.profiles
    umCustomers = um.customers
    umDefaultCustomer = um.defaultCustomer
  } catch (error) {
    userManagerAvailable = !isUserManagerUnavailable(error)
    if (userManagerAvailable) {
      console.warn('[mikrotik] user-manager sync skipped:', error.message)
    }
  }

  try {
    await withConnection(async (api) => {
      hotspotUsersCount = await printCount(api, '/ip/hotspot/user/print')
      umUsersCount = await printCount(api, '/tool/user-manager/user/print')
    })
  } catch (error) {
    console.warn('[mikrotik] card count skipped:', error.message)
  }

  const deletedManual = await deleteManualCategories()
  const umProfileNames = umProfiles.map((p) => p.name)
  const umNameSet = new Set(umProfileNames)
  const relabeled = userManagerAvailable
    ? await fixMislabeledUserManagerCategories(umProfileNames)
    : 0
  const deletedDupHotspot = userManagerAvailable
    ? await deleteDuplicateHotspotCategories(umProfileNames)
    : 0
  const deletedStaleHotspot = await deleteStaleRouterCategories(
    profiles.filter((p) => !umNameSet.has(p.name)).map((p) => p.name),
    ROUTER_SOURCE.HOTSPOT
  )
  const deletedStaleUm = userManagerAvailable
    ? await deleteStaleRouterCategories(umProfileNames, ROUTER_SOURCE.USER_MANAGER)
    : 0

  const categoryResults = []
  for (const profile of profiles) {
    if (umNameSet.has(profile.name)) continue
    const dur = profileDurationParts(profile)
    categoryResults.push(await upsertCategoryFromProfile({
      name: profile.name,
      ...dur,
      dataQuota: profileDataQuota(profile),
      source: ROUTER_SOURCE.HOTSPOT,
      price: 0,
    }))
  }

  if (userManagerAvailable) {
    for (const profile of umProfiles) {
      const dur = umProfileDurationParts(profile)
      categoryResults.push(await upsertCategoryFromProfile({
        name: profile.name,
        ...dur,
        dataQuota: umProfileDataQuota(profile),
        source: ROUTER_SOURCE.USER_MANAGER,
        price: umProfilePrice(profile),
      }))
    }
  }

  const { rows: settingsRows } = await query('SELECT digits, chars FROM card_settings WHERE id = 1')
  const cardSettings = settingsRows[0]
    ? { digits: settingsRows[0].digits, chars: settingsRows[0].chars, analyzed: 0, sampleCodes: [] }
    : null

  const totalCards = hotspotUsersCount + umUsersCount
  await syncRouterCardsCount(totalCards)

  return {
    categories: {
      synced: categoryResults.length,
      deletedManual,
      deletedStale: deletedStaleHotspot + deletedStaleUm + deletedDupHotspot,
      relabeled,
      profiles: categoryResults,
    },
    cardSettings,
    hotspotUsers: hotspotUsersCount,
    userManagerUsers: umUsersCount,
    totalCards,
    userManagerAvailable,
    userManager: {
      available: userManagerAvailable && umProfiles.length + umUsersCount + umCustomers.length > 0,
      customers: umCustomers.map((c) => ({
        login: customerLogin(c),
        name: c.name,
      })),
      defaultCustomer: umDefaultCustomer,
      profiles: umProfiles.length,
    },
    usersSample: [],
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

export async function pushUserManagerUsers({ profile, codes, customer }) {
  const profileName = profile
  if (!profileName || !codes?.length) {
    throw new Error('بروفايل User Manager والأكواد مطلوبان')
  }

  return withConnection(async (api) => {
    const cust = await resolveUserManagerCustomer(api, customer)

    for (const code of codes) {
      let added = false
      for (let attempt = 0; attempt < 5 && !added; attempt += 1) {
        try {
          await api.write('/tool/user-manager/user/add', [
            `=username=${code}`,
            `=password=${code}`,
            `=customer=${cust}`,
          ])
          await api.write('/tool/user-manager/user/create-and-activate-profile', [
            `=customer=${cust}`,
            `=numbers=${code}`,
            `=profile=${profileName}`,
          ])
          added = true
        } catch (error) {
          if (attempt === 4) throw error
        }
      }
    }

    const users = await api.write('/tool/user-manager/user/print')
    const umCount = Array.isArray(users) ? users.length : codes.length
    let hotspotCount = 0
    try {
      const hotspotUsers = await api.write('/ip/hotspot/user/print')
      hotspotCount = Array.isArray(hotspotUsers) ? hotspotUsers.length : 0
    } catch {
      hotspotCount = 0
    }

    const liveCount = hotspotCount + umCount
    await query('UPDATE mikrotik_routers SET cards_printed = $1', [liveCount])

    return { added: codes.length, totalOnRouter: liveCount, userManagerTotal: umCount, customer: cust }
  })
}

export async function pushRouterUsers({ source, profile, codes }) {
  const normalizedSource = normalizeRouterSource(source)
  if (normalizedSource === ROUTER_SOURCE.USER_MANAGER) {
    return pushUserManagerUsers({ profile, codes })
  }
  return pushHotspotUsers({ profile, codes })
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

    const hotspotUsers = await api.write('/ip/hotspot/user/print')
    const hotspotCount = Array.isArray(hotspotUsers) ? hotspotUsers.length : codes.length
    let umCount = 0
    try {
      const umUsers = await api.write('/tool/user-manager/user/print')
      umCount = Array.isArray(umUsers) ? umUsers.length : 0
    } catch {
      umCount = 0
    }

    const liveCount = hotspotCount + umCount
    await query('UPDATE mikrotik_routers SET cards_printed = $1', [liveCount])

    return { added: codes.length, totalOnRouter: liveCount }
  })
}
