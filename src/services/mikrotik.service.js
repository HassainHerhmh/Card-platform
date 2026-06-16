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

function getInventoryMaxCap() {
  return Math.max(1000, Number(env.mikrotik.inventoryMaxCards) || 50000)
}

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
    tls: env.mikrotik.useTls ? { rejectUnauthorized: false } : undefined,
  }
}

function formatHost(cfg) {
  if (!cfg.host) return ''
  return `${cfg.host}:${cfg.port}`
}

function getConnectTimeoutSec() {
  return Math.max(5, Number(env.mikrotik.connectTimeout) || 12)
}

function getOperationTimeoutSec(forInventory = false) {
  if (forInventory) {
    return Math.max(30, Number(env.mikrotik.inventoryTimeout) || 180)
  }
  return Math.max(10, Number(env.mikrotik.operationTimeout) || 30)
}

function createRouterApi(forInventory = false) {
  const cfg = getConnectionConfig()
  if (!cfg.host || !cfg.user || !cfg.password) {
    throw new Error('إعدادات الميكروتك غير مكتملة في ملف .env على السيرفر')
  }

  const connectTimeout = getConnectTimeoutSec()
  const api = new RouterOSAPI({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    timeout: connectTimeout,
    tls: cfg.tls,
  })

  return { cfg, api, operationTimeout: getOperationTimeoutSec(forInventory) }
}

async function connectRouter(api, operationTimeoutSec) {
  const connectTimeoutMs = getConnectTimeoutSec() * 1000
  let connectTimer = null

  try {
    await Promise.race([
      api.connect(),
      new Promise((_, reject) => {
        connectTimer = setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), connectTimeoutMs)
      }),
    ])
  } catch (error) {
    if (error?.message === 'CONNECT_TIMEOUT') {
      try {
        await Promise.race([
          Promise.resolve().then(() => api.close()),
          new Promise((resolve) => { setTimeout(resolve, 2000) }),
        ])
      } catch {
        // ignore close errors
      }
      throw new Error(`انتهت مهلة الاتصال (${getConnectTimeoutSec()} ث) — السيرفر لا يصل للراوتر بسرعة. تحقق من ${formatHost(getConnectionConfig())}`)
    }
    throw new Error(mapConnectionError(error))
  } finally {
    if (connectTimer) clearTimeout(connectTimer)
  }

  const opTimeout = Math.max(getConnectTimeoutSec(), Number(operationTimeoutSec) || getOperationTimeoutSec())
  if (api.connector) {
    api.connector.timeout = opTimeout
    if (api.connector.socket) {
      api.connector.socket.setTimeout(opTimeout * 1000)
    }
  }
  api.timeout = opTimeout
}

async function closeRouter(api) {
  try {
    await Promise.race([
      Promise.resolve().then(() => api.close()),
      new Promise((resolve) => { setTimeout(resolve, 3000) }),
    ])
  } catch {
    // ignore close errors
  }
}

async function withConnection(fn) {
  const { cfg, api, operationTimeout } = createRouterApi(false)

  try {
    await connectRouter(api, operationTimeout)
    return await fn(api, cfg)
  } finally {
    await closeRouter(api)
  }
}

async function withInventoryConnection(fn) {
  const { cfg, api, operationTimeout } = createRouterApi(true)

  setRouterInventoryBuildProgress('connecting', 0, 0)
  try {
    await connectRouter(api, operationTimeout)
    return await fn(api, cfg)
  } finally {
    await closeRouter(api)
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

/** عدّ سريع — يحاول count-only ثم عدّ السجلات مباشرة (متوافق مع RouterOS 6) */
async function countRecords(api, path, queryArgs = []) {
  try {
    const rows = await api.write(path, [...queryArgs, '=count-only='])
    if (rows?.[0]?.ret !== undefined && rows[0].ret !== null && rows[0].ret !== '') {
      const counted = Number(rows[0].ret) || 0
      if (counted > 0) return counted
    }
  } catch {
    // fallback below
  }

  try {
    const rows = await api.write(path, queryArgs)
    return Array.isArray(rows) ? rows.length : 0
  } catch {
    return 0
  }
}

async function printCount(api, path, queryArgs = []) {
  return countRecords(api, path, queryArgs)
}

async function countActiveUserManagerSessions(api) {
  try {
    const users = await api.write('/tool/user-manager/user/print', ['=.proplist=active-sessions'])
    const fromUsers = (users || []).reduce((sum, row) => sum + (Number(row['active-sessions']) || 0), 0)
    if (fromUsers > 0) return fromUsers
  } catch {
    // fallback below
  }

  try {
    const rows = await api.write('/tool/user-manager/session/print', ['?active=yes', '=count-only='])
    if (rows?.[0]?.ret !== undefined && rows[0].ret !== null && rows[0].ret !== '') {
      return Number(rows[0].ret) || 0
    }
  } catch {
    // fallback below
  }

  try {
    const rows = await api.write('/tool/user-manager/session/print', ['=.proplist=active,ended'])
    return (rows || []).filter((row) => {
      const active = row.active
      const ended = row.ended
      const isActive = active === true || active === 'true' || active === 'yes'
      const notEnded = ended === undefined || ended === null || ended === '' || ended === 'false' || ended === false
      return isActive && notEnded
    }).length
  } catch {
    return 0
  }
}

async function countConnectedNeighbors(api) {
  const paths = [
    '/ip/neighbor/print',
    '/interface/wireless/registration-table/print',
    '/caps-man/registration-table/print',
  ]

  for (const path of paths) {
    const count = await countRecords(api, path)
    if (count > 0) return count
  }

  return 0
}

async function fetchUserManagerStatusLite(api) {
  try {
    const [userManagerUsers, userManagerSessionsTotal, activeUserManagerSessions, umProfiles, customersRaw] = await Promise.all([
      printCount(api, '/tool/user-manager/user/print'),
      printCount(api, '/tool/user-manager/session/print'),
      countActiveUserManagerSessions(api),
      printCount(api, '/tool/user-manager/profile/print'),
      api.write('/tool/user-manager/customer/print').catch(() => []),
    ])

    const customers = (customersRaw || []).map(mapUserManagerCustomerRow)
    const defaultCustomer = pickDefaultUserManagerCustomer(customers, [])

    return {
      userManagerUsers,
      userManagerSessionsTotal,
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
      userManagerSessionsTotal: 0,
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

      const [hotspotUsers, activeHotspotUsers, umLite, neighborCount] = await Promise.all([
        printCount(api, '/ip/hotspot/user/print'),
        printCount(api, '/ip/hotspot/active/print'),
        fetchUserManagerStatusLite(api),
        countConnectedNeighbors(api),
      ])

      const { userManagerUsers, userManagerSessionsTotal, activeUserManagerSessions, userManager } = umLite

      const identity = identityRows?.[0] || {}
      const resource = resourceRows?.[0] || {}
      // المتصلون = نفس «متصل» في صفحة ميكروتك (Hotspot active)
      const connectedUsers = activeHotspotUsers

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
        userManagerSessionsTotal,
        activeUserManagerSessions,
        connectedUsers,
        activeUsers: connectedUsers,
        neighborCount,
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
  const assignedProfile = u.profile || ''
  return {
    id: u['.id'],
    serialNumber: extractRouterSerial(u),
    name: u.name || '',
    password: u.password || '',
    assignedProfile,
    profile: assignedProfile,
    packageLabel: assignedProfile,
    comment: u.comment || '',
    location: u.comment || '',
    pointOfSale: u.comment || '',
    disabled: u.disabled === 'true',
    uptime: u.uptime || '',
    limitUptime: u['limit-uptime'] || '',
    limitBytesIn: u['limit-bytes-in'] || '',
    limitBytesOut: u['limit-bytes-out'] || '',
    bytesIn: u['bytes-in'] || '',
    bytesOut: u['bytes-out'] || '',
    lastSeen: u['last-logged-out'] || u['last-logged-in'] || '',
  }
}

function parseByteLimit(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function hasCardUsage(user) {
  const usedSec = parseUsageSeconds(user.uptime)
  const bytesIn = Number(user.bytesIn || 0)
  const bytesOut = Number(user.bytesOut || 0)
  return usedSec > 0 || bytesIn > 0 || bytesOut > 0
}

/** حالات مخزون MikroTik: انتظار | نشط | انتهى الرصيد | معطل | خطاء في البروفايل */
function resolveCardStatus(user, validProfiles = null) {
  if (user.disabled) {
    return { status: 'disabled', label: 'معطل' }
  }

  const assignedProfile = user.assignedProfile || user.profile || ''
  if (!assignedProfile) {
    return { status: 'profile_error', label: 'خطاء في البروفايل' }
  }
  if (validProfiles?.size && !validProfiles.has(assignedProfile)) {
    return { status: 'profile_error', label: 'خطاء في البروفايل' }
  }

  const usedSec = parseUsageSeconds(user.uptime)
  const limitUptimeSec = parseUsageSeconds(user.limitUptime)
  const bytesIn = Number(user.bytesIn || 0)
  const bytesOut = Number(user.bytesOut || 0)
  const limitBytesIn = parseByteLimit(user.limitBytesIn)
  const limitBytesOut = parseByteLimit(user.limitBytesOut)

  const uptimeExhausted = limitUptimeSec > 0 && usedSec >= limitUptimeSec
  const bytesExhausted =
    (limitBytesIn > 0 && bytesIn >= limitBytesIn) ||
    (limitBytesOut > 0 && bytesOut >= limitBytesOut)

  if (uptimeExhausted || bytesExhausted) {
    return { status: 'expired', label: 'انتهى الرصيد' }
  }
  if (hasCardUsage(user)) {
    return { status: 'active', label: 'نشط' }
  }
  return { status: 'available', label: 'انتظار' }
}

export async function getHotspotInventory() {
  return withConnection(async (api) => {
    const [users, activeSessions] = await Promise.all([
      api.write('/ip/hotspot/user/print'),
      api.write('/ip/hotspot/active/print').catch(() => []),
    ])

    const profilesRaw = await api.write('/ip/hotspot/user/profile/print', ['=.proplist=name']).catch(() => [])
    const validProfiles = new Set((profilesRaw || []).map((p) => p.name).filter(Boolean))

    const cards = (users || []).map((u) => {
      const row = mapHotspotUserRow(u)
      const { status, label } = resolveCardStatus(row, validProfiles)
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
      active: cards.filter((c) => c.status === 'active').length,
      expired: cards.filter((c) => c.status === 'expired').length,
      disabled: cards.filter((c) => c.status === 'disabled').length,
      profile_error: cards.filter((c) => c.status === 'profile_error').length,
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

function mapUserManagerUserRow(u, profileHint = '') {
  const assignedProfile = u.profile || profileHint || ''
  const actualProfile = u['actual-profile'] || ''
  const displayProfile = actualProfile || assignedProfile || profileHint
  return {
    id: u['.id'],
    serialNumber: extractRouterSerial(u),
    name: u.name || u.username || '',
    password: u.password || '',
    assignedProfile,
    actualProfile,
    profile: displayProfile,
    packageLabel: displayProfile,
    comment: u.comment || '',
    location: u.location || '',
    pointOfSale: u.location || u.comment || '',
    disabled: u.disabled === 'true',
    uptime: u['uptime-used'] || '',
    limitUptime: u['uptime-limit'] || '',
    bytesIn: u['download-used'] || '',
    bytesOut: u['upload-used'] || '',
    lastSeen: u['last-seen'] || '',
    registrationDate: u['registration-date'] || '',
    customer: u.customer || '',
  }
}

async function fetchUmUserProfileNameMap(api) {
  const byUser = new Map()
  const paths = [
    '/tool/user-manager/user-profile/print',
    '/user-manager/user-profile/print',
  ]

  for (const path of paths) {
    try {
      const rows = await api.write(path, ['=.proplist=user,username,profile,actual-profile'])
      for (const row of rows || []) {
        const userName = row.user || row.username
        const profileName = row.profile || row['actual-profile']
        if (userName && profileName) byUser.set(String(userName), String(profileName))
      }
      if (byUser.size > 0) break
    } catch {
      // try next path
    }
  }

  return byUser
}

function buildUmProfileLimitsIndex(profilesRaw, limitsByProfile) {
  const index = new Map()
  for (const profile of profilesRaw || []) {
    if (!profile?.name) continue
    index.set(profile.name, limitsByProfile?.[profile.name] || {})
  }
  return index
}

function parseLimitBytes(value) {
  if (value == null || value === '' || value === '0' || value === '00:00:00') return 0
  const raw = String(value).trim().toLowerCase()
  const direct = Number(raw)
  if (Number.isFinite(direct) && direct > 0) return direct

  const match = raw.match(/^([\d.]+)\s*([kmg])?/)
  if (!match) return 0
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const unit = match[2]
  if (unit === 'g') return Math.round(amount * 1073741824)
  if (unit === 'm') return Math.round(amount * 1048576)
  if (unit === 'k') return Math.round(amount * 1024)
  return Math.round(amount)
}

function isUmBalanceExhausted(user, profileLimits = null) {
  const usedSec = parseUsageSeconds(user.uptime)
  const limitSec = parseUsageSeconds(user.limitUptime)
  const bytesIn = Number(user.bytesIn || 0)
  const bytesOut = Number(user.bytesOut || 0)
  const totalBytes = bytesIn + bytesOut
  const hasUsage = usedSec > 0 || bytesIn > 0 || bytesOut > 0

  if (limitSec > 0 && usedSec >= limitSec) return true

  const profileName = user.actualProfile || user.assignedProfile || user.profile || ''
  const limits = profileName && profileLimits?.get ? profileLimits.get(profileName) : null
  const transferLimit = parseLimitBytes(limits?.['transfer-limit'] ?? limits?.transferLimit)
  const downloadLimit = parseLimitBytes(limits?.['download-limit'] ?? limits?.downloadLimit)
  const uploadLimit = parseLimitBytes(limits?.['upload-limit'] ?? limits?.uploadLimit)

  if (transferLimit > 0 && totalBytes >= Math.max(0, transferLimit - 2048)) return true
  if (downloadLimit > 0 && bytesIn >= Math.max(0, downloadLimit - 2048)) return true
  if (uploadLimit > 0 && bytesOut >= Math.max(0, uploadLimit - 2048)) return true

  const hasAssigned = Boolean(user.assignedProfile)
  const hasActual = Boolean(user.actualProfile)
  if (hasUsage && (!hasActual || (!hasAssigned && !hasActual))) return true

  return false
}

function extractRouterSerial(u) {
  const regKey = u['reg-key']
  if (regKey != null && regKey !== '' && regKey !== '0') return String(regKey)
  const id = u['.id']
  if (id != null && id !== '') return String(id).replace(/^\*/, '')
  return ''
}

async function loadPlatformCardIndex({ refresh = false } = {}) {
  const now = Date.now()
  if (!refresh && platformCardIndex && now - platformCardIndexAt < PLATFORM_CARD_INDEX_MS) {
    return platformCardIndex
  }

  const { rows } = await query(
    `SELECT c.id AS cardId, c.code, c.status AS dbStatus, b.category_name AS categoryName,
            b.printed_at AS printedAt, b.router_source AS routerSource,
            COALESCE(cat.router_profile, b.category_name) AS profile,
            a.name AS agentName
     FROM cards c
     INNER JOIN batches b ON b.id = c.batch_id
     LEFT JOIN categories cat ON cat.id = b.category_id
     LEFT JOIN agents a ON a.id = b.agent_id`
  )

  const byCode = new Map()
  for (const row of rows || []) {
    if (row.code) byCode.set(String(row.code), row)
  }

  platformCardIndex = byCode
  platformCardIndexAt = now
  return byCode
}

function enrichInventoryCardsWithPlatform(cards, platformIndex) {
  if (!platformIndex?.size || !cards?.length) return cards

  return cards.map((card) => {
    const meta = platformIndex.get(card.name)
    if (!meta) return card

    return finishInventoryCard(card, {
      serialNumber: meta.cardId != null ? String(meta.cardId) : card.serialNumber,
      pointOfSale: meta.agentName || card.pointOfSale || '',
      printedAt: meta.printedAt ?? card.printedAt,
      dbStatus: meta.dbStatus ?? card.dbStatus,
      packageLabel: card.packageLabel || meta.profile || meta.categoryName || '',
    })
  })
}

async function applyPlatformInventoryEnrichment(snapshot, { refresh = false } = {}) {
  if (!snapshot?.cards?.length) return snapshot

  const platformIndex = await loadPlatformCardIndex({ refresh })
  const cards = enrichInventoryCardsWithPlatform(snapshot.cards, platformIndex)
  return {
    ...snapshot,
    cards,
    summary: computeInventorySummary(cards),
  }
}

function formatTrafficAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '0.00'
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} جيجا`
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)} ميجا`
  if (n >= 1024) return `${(n / 1024).toFixed(2)} ك.ب`
  return `${n.toFixed(2)} بايت`
}

function formatTotalTraffic(bytesIn, bytesOut) {
  const total = Number(bytesIn || 0) + Number(bytesOut || 0)
  if (total <= 0) return '0.00'
  return formatTrafficAmount(total)
}

function parseRosDurationToSeconds(value) {
  if (value == null || value === '' || value === '0' || value === '0s') return 0
  const raw = String(value).trim().toLowerCase()
  const hms = raw.match(/^(\d+):(\d{2}):(\d{2})$/)
  if (hms) {
    return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])
  }
  let total = 0
  const parts = [...raw.matchAll(/(\d+)([wdhms])/g)]
  if (parts.length) {
    for (const [, n, unit] of parts) {
      const num = Number(n)
      if (unit === 'w') total += num * 7 * 24 * 3600
      else if (unit === 'd') total += num * 24 * 3600
      else if (unit === 'h') total += num * 3600
      else if (unit === 'm') total += num * 60
      else if (unit === 's') total += num
    }
    return total
  }
  const parsed = parseRosTime(value)
  if (!parsed) return 0
  return parsed.hours * 3600 + parsed.minutes * 60
}

function formatRosDurationToHms(value) {
  if (value == null || value === '' || value === '0' || value === '0s') return '0'
  const raw = String(value).trim()
  if (/^\d+:\d{2}:\d{2}$/.test(raw)) return raw
  const totalSec = parseRosDurationToSeconds(value)
  if (totalSec <= 0) return '0'
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatUptimeDisplay(value) {
  return formatRosDurationToHms(value)
}

function formatLastSeen(value) {
  if (value == null || value === '' || String(value).toLowerCase() === 'never') return 'never'
  return String(value).trim()
}

const CONNECTED_RECENCY_MS = 45 * 60 * 1000

function parseMikrotikLastSeen(value) {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  if (/^never$/i.test(raw)) return null

  const match = raw.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/i)
  if (match) {
    const months = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }
    const monthIdx = months[match[1].toLowerCase()]
    if (monthIdx == null) return null
    const dt = new Date(
      Number(match[3]),
      monthIdx,
      Number(match[2]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    )
    if (Number.isNaN(dt.getTime()) || dt.getFullYear() < 2020) return null
    return dt
  }

  const iso = Date.parse(raw)
  if (!Number.isNaN(iso)) {
    const dt = new Date(iso)
    if (dt.getFullYear() < 2020) return null
    return dt
  }
  return null
}

function isRecentlyConnected(lastSeen, windowMs = CONNECTED_RECENCY_MS) {
  const dt = parseMikrotikLastSeen(lastSeen)
  if (!dt) return false
  const ageMs = Date.now() - dt.getTime()
  return ageMs >= 0 && ageMs <= windowMs
}

function isUserCurrentlyOnline(user, activeUsernames) {
  if (activeUsernames?.has(user.name)) return true
  return isRecentlyConnected(user.lastSeen)
}

function finishInventoryCard(card, extras = {}) {
  const bytesIn = Number(card.bytesIn || 0)
  const bytesOut = Number(card.bytesOut || 0)
  const usedTime = formatUptimeDisplay(card.uptime || card.sessionUptime)
  return {
    ...card,
    ...extras,
    serialNumber: extras.serialNumber || card.serialNumber || '',
    packageLabel: card.packageLabel || card.profile || extras.categoryName || '',
    pointOfSale: extras.pointOfSale || card.pointOfSale || card.location || '',
    usedTime,
    totalTraffic: formatTotalTraffic(bytesIn, bytesOut),
    downloadUsed: formatTrafficAmount(bytesIn),
    uploadUsed: formatTrafficAmount(bytesOut),
    lastSeen: formatLastSeen(extras.lastSeen ?? card.lastSeen),
    password: card.password || '',
  }
}

function parseUsageSeconds(value) {
  return parseRosDurationToSeconds(value)
}

function resolveUserManagerCardStatus(user, validProfiles = null, profileLimits = null) {
  if (user.disabled) {
    return { status: 'disabled', label: 'معطل' }
  }

  const assignedProfile = user.assignedProfile ?? ''
  const actualProfile = user.actualProfile ?? ''
  const hasAssigned = Boolean(assignedProfile)
  const hasActual = Boolean(actualProfile)

  const usedSec = parseUsageSeconds(user.uptime)
  const bytesIn = Number(user.bytesIn || 0)
  const bytesOut = Number(user.bytesOut || 0)
  const hasUsage = usedSec > 0 || bytesIn > 0 || bytesOut > 0

  if (isUmBalanceExhausted(user, profileLimits)) {
    return { status: 'expired', label: 'انتهى الرصيد' }
  }

  if (!hasAssigned && !hasActual) {
    return hasUsage
      ? { status: 'expired', label: 'انتهى الرصيد' }
      : { status: 'profile_error', label: 'خطاء في البروفايل' }
  }

  if (hasAssigned && validProfiles?.size && !validProfiles.has(assignedProfile) && !hasUsage) {
    return { status: 'profile_error', label: 'خطاء في البروفايل' }
  }

  if (hasAssigned && !hasActual) {
    return { status: 'available', label: 'انتظار' }
  }

  if (hasUsage) {
    return { status: 'active', label: 'نشط' }
  }
  return { status: 'available', label: 'انتظار' }
}

export async function getUserManagerInventory() {
  return withConnection(async (api) => {
    const um = await fetchUserManagerSnapshot(api)

    const profilesRaw = await api.write('/tool/user-manager/profile/print').catch(() => [])
    const validProfiles = new Set((profilesRaw || []).map((p) => p.name).filter(Boolean))
    const limitsByProfile = await fetchUserManagerLimitationData(api, profilesRaw)
    const profileLimits = buildUmProfileLimitsIndex(profilesRaw, limitsByProfile)
    const userProfileMap = await fetchUmUserProfileNameMap(api)

    const cards = um.users.map((row) => {
      const enriched = mapUserManagerUserRow(
        { ...row, profile: row.assignedProfile, 'actual-profile': row.actualProfile },
        userProfileMap.get(row.name) || ''
      )
      const { status, label } = resolveUserManagerCardStatus(enriched, validProfiles, profileLimits)
      const activeSession = um.sessions.find(
        (s) => (s.user || s.username) === row.name
      )
      return {
        ...enriched,
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
      active: cards.filter((c) => c.status === 'active').length,
      expired: cards.filter((c) => c.status === 'expired').length,
      disabled: cards.filter((c) => c.status === 'disabled').length,
      profile_error: cards.filter((c) => c.status === 'profile_error').length,
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
  if (period === 'day' || period === 'month' || period === 'week' || period === 'all') return period
  return 'day'
}

function resolveInventoryFilter(options = {}) {
  const date = String(options.date || '').trim()
  const month = String(options.month || '').trim()
  const period = normalizeInventoryPeriod(options.period || 'day')

  if (period === 'all') {
    return { type: 'all', period, periodLabel: 'كل الكروت' }
  }

  if (period === 'month') {
    const m = /^\d{4}-\d{2}$/.test(month) ? month : date.slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(m)) {
      const [year, monthNum] = m.split('-')
      return {
        type: 'monthPick',
        year,
        month: monthNum,
        period: 'monthPick',
        periodLabel: `شهر ${monthNum}/${year}`,
      }
    }
  }

  if (period === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number)
    const ref = new Date(y, m - 1, d)
    const fromDate = new Date(ref)
    fromDate.setDate(ref.getDate() - 6)
    const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
    return {
      type: 'range',
      from,
      to: date,
      period: 'week',
      periodLabel: `أسبوع حتى ${date}`,
    }
  }

  if (period === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      type: 'date',
      date,
      period: 'date',
      periodLabel: `يوم ${date}`,
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      type: 'date',
      date,
      period: 'date',
      periodLabel: `يوم ${date}`,
    }
  }

  if (/^\d{4}-\d{2}$/.test(month)) {
    const [year, monthNum] = month.split('-')
    return {
      type: 'monthPick',
      year,
      month: monthNum,
      period: 'monthPick',
      periodLabel: `شهر ${monthNum}/${year}`,
    }
  }

  return { type: 'preset', period, periodLabel: periodLabelAr(period) }
}

function buildInventoryWhere(filter) {
  switch (filter.type) {
    case 'date':
      return { clause: 'DATE(b.printed_at) = ?', params: [filter.date] }
    case 'monthPick':
      return { clause: 'YEAR(b.printed_at) = ? AND MONTH(b.printed_at) = ?', params: [filter.year, filter.month] }
    case 'range':
      return { clause: 'DATE(b.printed_at) >= ? AND DATE(b.printed_at) <= ?', params: [filter.from, filter.to] }
    case 'all':
      return { clause: '1=1', params: [] }
    default:
      return { clause: periodSqlWhere(filter.period), params: [] }
  }
}

function periodLabelAr(period) {
  if (period === 'day') return 'اليوم'
  if (period === 'month') return 'آخر 30 يوم'
  if (period === 'all') return 'كل الكروت'
  return 'آخر 7 أيام'
}

function periodSqlWhere(period) {
  if (period === 'day') return 'b.printed_at >= CURDATE()'
  if (period === 'month') return 'b.printed_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)'
  if (period === 'all') return '1=1'
  return 'b.printed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)'
}

async function countPrintedCardsForPeriod(filterOptions = {}) {
  const filter = resolveInventoryFilter(filterOptions)
  const { clause, params } = buildInventoryWhere(filter)
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt
     FROM cards c
     INNER JOIN batches b ON b.id = c.batch_id
     WHERE ${clause}`,
    params
  )
  const dbTotal = Number(rows[0]?.cnt) || 0
  const cap = getInventoryMaxCap()
  return {
    total: Math.min(dbTotal, cap),
    dbTotal,
    truncated: dbTotal > cap,
    period: filter.period,
    periodLabel: filter.periodLabel,
  }
}

function normalizeInventoryCardFilters(options = {}) {
  const status = String(options.status || 'all').trim()
  const source = String(options.source || 'all').trim()
  const validStatuses = new Set([
    'available', 'active', 'expired', 'disabled', 'profile_error', 'missing', 'pending',
  ])
  const normalizedStatus = status === 'connected' ? 'active' : status
  return {
    status: validStatuses.has(normalizedStatus) ? normalizedStatus : null,
    source: source === 'hotspot' || source === 'user-manager' ? source : null,
  }
}

function applyInventoryCardFilters(cards, filters) {
  let result = cards
  if (filters.status) result = result.filter((c) => c.status === filters.status)
  if (filters.source) result = result.filter((c) => c.source === filters.source)
  return result
}

function hasActiveInventoryCardFilters(cardFilters) {
  return Boolean(cardFilters?.status || cardFilters?.source)
}

async function fetchRouterUsersByQuery(api, path, primaryProplist, queryArgs = []) {
  try {
    const rows = await api.write(path, [primaryProplist, ...queryArgs])
    if (Array.isArray(rows) && rows.length > 0) return dedupeRouterRows(rows)
  } catch (error) {
    if (isUserManagerUnavailable(error)) return []
    throw error
  }

  try {
    const rows = await api.write(path, queryArgs)
    return dedupeRouterRows(rows || [])
  } catch (error) {
    if (isUserManagerUnavailable(error)) return []
    throw error
  }
}

export async function getInventoryCount(filterOptions = {}) {
  const refresh = filterOptions.refresh === true || filterOptions.refresh === '1'
  const filter = resolveInventoryFilter(filterOptions)
  if (filter.type === 'all') {
    const cap = getInventoryMaxCap()
    const cardFilters = normalizeInventoryCardFilters(filterOptions)
    const hasCardFilter = hasActiveInventoryCardFilters(cardFilters)

    if (refresh && cardFilters.status === 'disabled') {
      const snapshot = await getDisabledRouterInventorySnapshot(filterOptions, { refresh: true })
      const filtered = applyInventoryCardFilters(snapshot.cards, cardFilters)
      const routerTotal = filtered.length
      return {
        total: Math.min(routerTotal, cap),
        dbTotal: 0,
        routerTotal,
        truncated: routerTotal > cap,
        period: filter.period,
        periodLabel: filter.periodLabel,
        routerSource: true,
        cached: true,
        building: false,
        needsRefresh: false,
        fetchedAt: snapshot.fetchedAt,
        fastFilter: true,
      }
    }

    if (refresh && hasCardFilter) {
      const snapshot = await getCachedRouterInventory({ refresh: false, filterOptions })
      if (snapshot?.cards?.length) {
        const filtered = applyInventoryCardFilters(snapshot.cards, cardFilters)
        const routerTotal = filtered.length
        return {
          total: Math.min(routerTotal, cap),
          dbTotal: 0,
          routerTotal,
          truncated: routerTotal > cap,
          period: filter.period,
          periodLabel: filter.periodLabel,
          routerSource: true,
          cached: true,
          building: false,
          needsRefresh: false,
          fetchedAt: snapshot.fetchedAt,
        }
      }
      return {
        total: 0,
        dbTotal: 0,
        routerTotal: 0,
        truncated: false,
        period: filter.period,
        periodLabel: filter.periodLabel,
        routerSource: true,
        cached: false,
        building: false,
        needsRefresh: true,
        message: 'لا يوجد مخزون محفوظ لهذه الفلترة — حدّث «الكل» أولاً أو استخدم فلتر «معطّل» للتحديث السريع',
      }
    }

    if (refresh) {
      void ensureRouterInventoryBuild().catch((error) => {
        console.error('[mikrotik] inventory build failed:', error.message)
      })
      const progress = getRouterInventorySyncProgress()
      if (routerInventoryBuildPromise || progress.active) {
        return {
          total: progress.fetched || 0,
          dbTotal: 0,
          routerTotal: progress.total || 0,
          truncated: false,
          period: filter.period,
          periodLabel: filter.periodLabel,
          routerSource: true,
          cached: false,
          building: true,
          needsRefresh: false,
          progress,
          fetchedAt: null,
        }
      }
    }

    const snapshot = await getCachedRouterInventory({ refresh: false, filterOptions })
    if (!snapshot?.cards?.length) {
      if (cardFilters.status === 'disabled' && disabledRouterInventoryCache?.cards?.length) {
        const filtered = applyInventoryCardFilters(disabledRouterInventoryCache.cards, cardFilters)
        const routerTotal = filtered.length
        return {
          total: Math.min(routerTotal, cap),
          dbTotal: 0,
          routerTotal,
          truncated: routerTotal > cap,
          period: filter.period,
          periodLabel: filter.periodLabel,
          routerSource: true,
          cached: true,
          building: false,
          needsRefresh: false,
          fetchedAt: disabledRouterInventoryCache.fetchedAt,
          fastFilter: true,
        }
      }
      return {
        total: 0,
        dbTotal: 0,
        routerTotal: 0,
        truncated: false,
        period: filter.period,
        periodLabel: filter.periodLabel,
        routerSource: true,
        cached: false,
        building: false,
        needsRefresh: true,
        message: 'لا يوجد مخزون محفوظ — اضغط «تحديث» للمزامنة من الراوتر',
      }
    }

    const filtered = applyInventoryCardFilters(snapshot.cards, cardFilters)
    const routerTotal = cardFilters.status || cardFilters.source ? filtered.length : snapshot.cards.length
    return {
      total: Math.min(routerTotal, cap),
      dbTotal: 0,
      routerTotal,
      truncated: routerTotal > cap,
      period: filter.period,
      periodLabel: filter.periodLabel,
      routerSource: true,
      cached: true,
      building: false,
      needsRefresh: false,
      fetchedAt: snapshot.fetchedAt,
    }
  }
  return countPrintedCardsForPeriod(filterOptions)
}

let routerInventoryCache = null
let routerInventoryCacheAt = 0
let routerInventoryBuildPromise = null
let routerInventoryBuildProgress = {
  active: false,
  phase: '',
  fetched: 0,
  total: 0,
  percent: 0,
}
let disabledRouterInventoryCache = null
let disabledRouterInventoryCacheAt = 0
let platformCardIndex = null
let platformCardIndexAt = 0
const ROUTER_INVENTORY_CACHE_MS = 24 * 60 * 60 * 1000
const DISABLED_INVENTORY_CACHE_MS = 5 * 60 * 1000
const PLATFORM_CARD_INDEX_MS = 5 * 60 * 1000

export function getRouterInventorySyncProgress() {
  return { ...routerInventoryBuildProgress }
}

function resetRouterInventoryBuildProgress() {
  routerInventoryBuildProgress = {
    active: false,
    phase: '',
    fetched: 0,
    total: 0,
    percent: 0,
  }
}

function setRouterInventoryBuildProgress(phase, fetched, total) {
  const safeTotal = Math.max(0, Number(total) || 0)
  const safeFetched = Math.max(0, Number(fetched) || 0)
  routerInventoryBuildProgress = {
    active: true,
    phase,
    fetched: safeFetched,
    total: safeTotal,
    percent: safeTotal > 0
      ? Math.min(99, Math.round((safeFetched / safeTotal) * 100))
      : 0,
  }
}

function finishRouterInventoryBuildProgress(total) {
  const safeTotal = Math.max(0, Number(total) || 0)
  routerInventoryBuildProgress = {
    active: false,
    phase: 'done',
    fetched: safeTotal,
    total: safeTotal,
    percent: 100,
  }
}

function markRouterInventoryBuildError(error) {
  routerInventoryBuildProgress = {
    active: false,
    phase: 'error',
    fetched: 0,
    total: 0,
    percent: 0,
    error: mapConnectionError(error),
  }
}

let routerEnrichmentIndex = null
let routerEnrichmentIndexAt = 0
const ROUTER_ENRICHMENT_INDEX_MS = 2 * 60 * 1000

function invalidateRouterEnrichmentIndex() {
  routerEnrichmentIndex = null
  routerEnrichmentIndexAt = 0
}

const HS_USER_PROPS = [
  '=.proplist=name,profile,comment,disabled,uptime,bytes-in,bytes-out,limit-uptime,limit-bytes-in,limit-bytes-out,password,last-logged-out,last-logged-in',
]
const UM_USER_PROPS = [
  '=.proplist=name,username,actual-profile,profile,disabled,uptime-used,download-used,upload-used,uptime-limit,password,comment,location,last-seen,reg-key',
  '=.proplist=name,username,profile,disabled,password,comment,location',
  '=.proplist=name,username,profile,disabled',
]

const ROUTER_PRINT_PAGE_HINT = 1000

function dedupeRouterRows(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows || []) {
    const id = row['.id']
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(row)
  }
  return out
}

async function fetchPrintPages(api, path, proplist, expected = 0, onProgress = null, extraArgs = []) {
  const all = []
  let cursor = ''
  const staticQuery = (extraArgs || []).filter((a) => a.startsWith('?') && !a.startsWith('?#'))

  for (let page = 0; page < 200; page++) {
    const args = []
    if (proplist) args.push(proplist)
    args.push(...staticQuery)
    if (cursor) args.push(`?#>.id=${cursor}`)

    let batch
    try {
      batch = await api.write(path, args)
    } catch (error) {
      if (isUserManagerUnavailable(error)) return dedupeRouterRows(all)
      if (page === 0) throw error
      break
    }

    if (!Array.isArray(batch) || !batch.length) break

    const before = all.length
    for (const row of batch) {
      const id = row['.id']
      if (id && all.some((r) => r['.id'] === id)) continue
      all.push(row)
    }
    if (all.length === before) break

    const lastId = batch[batch.length - 1]?.['.id']
    if (!lastId) break
    if (expected > 0 && all.length >= expected) break
    if (batch.length < ROUTER_PRINT_PAGE_HINT) break

    cursor = lastId
    if (onProgress) onProgress(all.length, expected || all.length)
  }

  const unique = dedupeRouterRows(all)
  if (onProgress) onProgress(unique.length, expected || unique.length)
  if (expected > 0 && unique.length < expected) {
    console.warn(`[mikrotik] ${path} pagination got ${unique.length}/${expected}`)
  }
  return unique
}

async function printWithProplistFallback(api, path, proplistOrList, options = {}) {
  const { extraArgs = [], onProgress = null } = options
  const proplists = Array.isArray(proplistOrList) ? proplistOrList : [proplistOrList]
  const expected = await printCount(api, path, extraArgs).catch(() => 0)

  for (const proplist of proplists) {
    try {
      const withProps = await api.write(path, [proplist, ...extraArgs])
      if (Array.isArray(withProps) && withProps.length > 0) {
        if (!expected || withProps.length >= expected) {
          const rows = dedupeRouterRows(withProps)
          if (onProgress) onProgress(rows.length, expected || rows.length)
          return rows
        }
        console.warn(`[mikrotik] ${path} proplist partial ${withProps.length}/${expected} — paginating`)
        const paginated = await fetchPrintPages(api, path, proplist, expected, onProgress, extraArgs)
        if (paginated.length > withProps.length) return paginated
        return dedupeRouterRows(withProps)
      }
    } catch (error) {
      if (isUserManagerUnavailable(error)) return []
    }
  }

  try {
    if (expected > 0) {
      console.warn(`[mikrotik] ${path} proplist returned 0/${expected} — using paginated print`)
      for (const proplist of proplists) {
        const paginated = await fetchPrintPages(api, path, proplist, expected, onProgress, extraArgs)
        if (paginated.length > 0) return paginated
      }
      return await fetchPrintPages(api, path, null, expected, onProgress, extraArgs)
    }
    const rows = dedupeRouterRows(await api.write(path, extraArgs))
    if (onProgress) onProgress(rows.length, rows.length)
    return rows
  } catch (error) {
    if (isUserManagerUnavailable(error)) return []
    try {
      console.warn(`[mikrotik] ${path} proplist failed (${error.message}) — using paginated print`)
      return await fetchPrintPages(api, path, proplists[0] || null, expected, onProgress, extraArgs)
    } catch (fallbackError) {
      if (isUserManagerUnavailable(fallbackError)) return []
      throw fallbackError
    }
  }
}

async function getRouterEnrichmentIndex(api, { refresh = false } = {}) {
  const now = Date.now()
  if (!refresh && routerEnrichmentIndex && now - routerEnrichmentIndexAt < ROUTER_ENRICHMENT_INDEX_MS) {
    return routerEnrichmentIndex
  }

  let userManagerAvailable = true

  const [activeHotspotSessions, umSessionsRaw] = await Promise.all([
    api.write('/ip/hotspot/active/print', ['=.proplist=user,address,uptime']).catch(() => []),
    api.write('/tool/user-manager/session/print', ['=.proplist=user,username,ip-address,address,uptime']).catch(() => []),
  ])

  const hotspotIndex = {
    byName: new Map(),
    profileNames: new Set(),
    activeSessions: activeHotspotSessions || [],
  }

  const umIndex = {
    byName: new Map(),
    profileNames: new Set(),
    sessions: umSessionsRaw || [],
  }

  const [hotspotUsersRaw, umUsersRaw, hotspotProfilesRaw, umProfilesRaw] = await Promise.all([
    printWithProplistFallback(api, '/ip/hotspot/user/print', HS_USER_PROPS[0]),
    printWithProplistFallback(api, '/tool/user-manager/user/print', UM_USER_PROPS).catch((error) => {
      if (isUserManagerUnavailable(error)) {
        userManagerAvailable = false
        return []
      }
      throw error
    }),
    api.write('/ip/hotspot/user/profile/print', ['=.proplist=name']).catch(() => []),
    api.write('/tool/user-manager/profile/print', ['=.proplist=name']).catch(() => []),
  ])

  for (const p of hotspotProfilesRaw || []) {
    if (p.name) hotspotIndex.profileNames.add(p.name)
  }
  for (const p of umProfilesRaw || []) {
    if (p.name) umIndex.profileNames.add(p.name)
  }

  for (const u of hotspotUsersRaw || []) {
    const row = mapHotspotUserRow(u)
    if (row.name) hotspotIndex.byName.set(row.name, row)
  }

  for (const u of umUsersRaw || []) {
    const row = mapUserManagerUserRow(u)
    if (row.name) umIndex.byName.set(row.name, row)
  }

  routerEnrichmentIndex = {
    hotspotIndex,
    umIndex,
    userManagerAvailable,
    hotspotOk: true,
    umOk: userManagerAvailable,
  }
  routerEnrichmentIndexAt = Date.now()
  return routerEnrichmentIndex
}

async function buildRouterInventorySnapshot(api) {
  setRouterInventoryBuildProgress('counting', 0, 0)

  const [hsCount, umCount] = await Promise.all([
    printCount(api, '/ip/hotspot/user/print').catch(() => 0),
    printCount(api, '/tool/user-manager/user/print').catch(() => 0),
  ])
  const totalExpected = (Number(hsCount) || 0) + (Number(umCount) || 0)
  setRouterInventoryBuildProgress('hotspot', 0, totalExpected)

  let fetchedSoFar = 0
  const onHotspotProgress = (fetched) => {
    fetchedSoFar = fetched
    setRouterInventoryBuildProgress('hotspot', fetched, totalExpected)
  }
  const onUmProgress = (fetched) => {
    setRouterInventoryBuildProgress('user-manager', fetchedSoFar + fetched, totalExpected)
  }

  const [
    hotspotUsersRaw,
    activeHotspotSessions,
    umUsersRaw,
    umSessionsRaw,
    umUserCount,
    hotspotProfilesRaw,
    umProfilesRaw,
    umUserProfileMap,
  ] = await Promise.all([
    printWithProplistFallback(api, '/ip/hotspot/user/print', HS_USER_PROPS[0], { onProgress: onHotspotProgress }),
    api.write('/ip/hotspot/active/print', ['=.proplist=user,address,uptime']).catch(() => []),
    printWithProplistFallback(api, '/tool/user-manager/user/print', UM_USER_PROPS, { onProgress: onUmProgress }),
    api.write('/tool/user-manager/session/print', ['=.proplist=user,username,ip-address,address,uptime']).catch(() => []),
    printCount(api, '/tool/user-manager/user/print').catch(() => 0),
    api.write('/ip/hotspot/user/profile/print', ['=.proplist=name']).catch(() => []),
    api.write('/tool/user-manager/profile/print').catch(() => []),
    fetchUmUserProfileNameMap(api),
  ])

  setRouterInventoryBuildProgress('building', totalExpected, totalExpected)

  const limitsByProfile = await fetchUserManagerLimitationData(api, umProfilesRaw)
  const umProfileLimits = buildUmProfileLimitsIndex(umProfilesRaw, limitsByProfile)
  const hotspotProfileNames = new Set((hotspotProfilesRaw || []).map((p) => p.name).filter(Boolean))
  const umProfileNames = new Set((umProfilesRaw || []).map((p) => p.name).filter(Boolean))

  const hotspotCards = (hotspotUsersRaw || []).map((u) => {
    const row = mapHotspotUserRow(u)
    return buildHotspotInventoryCard(row, hotspotProfileNames, activeHotspotSessions || [])
  })

  const umSessions = umSessionsRaw || []

  const umCards = (umUsersRaw || []).map((u) => {
    const userName = u.name || u.username || ''
    const row = mapUserManagerUserRow(u, umUserProfileMap.get(userName) || '')
    return buildUserManagerInventoryCard(row, umProfileNames, umSessions, umProfileLimits)
  })

  const userManagerMeta = {
    available: umCards.length > 0 || umSessions.length > 0 || umUserCount > 0,
    customers: [],
    defaultCustomer: null,
    profiles: 0,
    userCount: umUserCount || umCards.length,
  }

  const cards = [...hotspotCards, ...umCards]
  cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  finishRouterInventoryBuildProgress(cards.length)
  console.info(`[mikrotik] router inventory snapshot: ${cards.length} cards (HS ${hotspotCards.length}, UM ${umCards.length})`)

  return {
    cards,
    summary: computeInventorySummary(cards),
    sources: {
      hotspot: hotspotCards.length > 0 || umCards.length === 0,
      userManager: userManagerMeta.available,
    },
    userManager: userManagerMeta,
    fetchedAt: new Date().toISOString(),
  }
}

async function buildDisabledRouterInventorySnapshot(api, filterOptions = {}) {
  const cardFilters = normalizeInventoryCardFilters(filterOptions)
  const sourceFilter = cardFilters.source
  const disabledQuery = ['?disabled=yes']

  const [
    activeHotspotSessions,
    umSessionsRaw,
    hotspotProfilesRaw,
    umProfilesRaw,
    umUserProfileMap,
    hotspotUsersRaw,
    umUsersRaw,
  ] = await Promise.all([
    api.write('/ip/hotspot/active/print', ['=.proplist=user,address,uptime']).catch(() => []),
    api.write('/tool/user-manager/session/print', ['=.proplist=user,username,ip-address,address,uptime']).catch(() => []),
    api.write('/ip/hotspot/user/profile/print', ['=.proplist=name']).catch(() => []),
    api.write('/tool/user-manager/profile/print').catch(() => []),
    fetchUmUserProfileNameMap(api),
    !sourceFilter || sourceFilter === ROUTER_SOURCE.HOTSPOT
      ? fetchRouterUsersByQuery(api, '/ip/hotspot/user/print', HS_USER_PROPS[0], disabledQuery)
      : Promise.resolve([]),
    !sourceFilter || sourceFilter === ROUTER_SOURCE.USER_MANAGER
      ? fetchRouterUsersByQuery(api, '/tool/user-manager/user/print', UM_USER_PROPS[0], disabledQuery)
      : Promise.resolve([]),
  ])

  const limitsByProfile = await fetchUserManagerLimitationData(api, umProfilesRaw)
  const umProfileLimits = buildUmProfileLimitsIndex(umProfilesRaw, limitsByProfile)
  const hotspotProfileNames = new Set((hotspotProfilesRaw || []).map((p) => p.name).filter(Boolean))
  const umProfileNames = new Set((umProfilesRaw || []).map((p) => p.name).filter(Boolean))

  const hotspotCards = (hotspotUsersRaw || []).map((u) => {
    const row = mapHotspotUserRow(u)
    return buildHotspotInventoryCard(row, hotspotProfileNames, activeHotspotSessions || [])
  })

  const umSessions = umSessionsRaw || []
  const umCards = (umUsersRaw || []).map((u) => {
    const userName = u.name || u.username || ''
    const row = mapUserManagerUserRow(u, umUserProfileMap.get(userName) || '')
    return buildUserManagerInventoryCard(row, umProfileNames, umSessions, umProfileLimits)
  })

  const cards = [...hotspotCards, ...umCards]
  cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  console.info(`[mikrotik] disabled-only inventory: ${cards.length} cards (HS ${hotspotCards.length}, UM ${umCards.length})`)

  return {
    cards,
    summary: computeInventorySummary(cards),
    sources: {
      hotspot: hotspotCards.length > 0,
      userManager: umCards.length > 0,
    },
    userManager: {
      available: umCards.length > 0,
      customers: [],
      defaultCustomer: null,
      profiles: 0,
      userCount: umCards.length,
    },
    fetchedAt: new Date().toISOString(),
    filteredFetch: true,
  }
}

async function getDisabledRouterInventorySnapshot(filterOptions = {}, { refresh = false } = {}) {
  const now = Date.now()
  if (!refresh && disabledRouterInventoryCache && now - disabledRouterInventoryCacheAt < DISABLED_INVENTORY_CACHE_MS) {
    return disabledRouterInventoryCache
  }
  const snapshot = await withInventoryConnection((api) => buildDisabledRouterInventorySnapshot(api, filterOptions))
  const enriched = await applyPlatformInventoryEnrichment(snapshot, { refresh })
  disabledRouterInventoryCache = enriched
  disabledRouterInventoryCacheAt = now
  return enriched
}

function ensureRouterInventoryBuild() {
  if (routerInventoryBuildPromise) return routerInventoryBuildPromise

  routerInventoryCache = null
  routerInventoryCacheAt = 0
  disabledRouterInventoryCache = null
  disabledRouterInventoryCacheAt = 0
  invalidateRouterEnrichmentIndex()
  resetRouterInventoryBuildProgress()
  setRouterInventoryBuildProgress('starting', 0, 0)

  routerInventoryBuildPromise = withInventoryConnection((api) => buildRouterInventorySnapshot(api))
    .then(async (snapshot) => {
      const enriched = await applyPlatformInventoryEnrichment(snapshot, { refresh: true })
      routerInventoryCache = enriched
      routerInventoryCacheAt = Date.now()
      finishRouterInventoryBuildProgress(enriched.cards.length)
      return enriched
    })
    .catch((error) => {
      markRouterInventoryBuildError(error)
      throw error
    })
    .finally(() => {
      routerInventoryBuildPromise = null
    })

  return routerInventoryBuildPromise
}

async function refreshSnapshotSessionStatuses(api, snapshot) {
  const [activeHotspotSessions, umSessionsRaw] = await Promise.all([
    api.write('/ip/hotspot/active/print', ['=.proplist=user,address,uptime']).catch(() => []),
    api.write('/tool/user-manager/session/print', ['=.proplist=user,username,ip-address,address,uptime']).catch(() => []),
  ])
  const umSessions = umSessionsRaw || []

  const cards = snapshot.cards.map((card) => {
    if (card.source === ROUTER_SOURCE.USER_MANAGER) {
      const activeSession = umSessions.find((s) => (s.user || s.username) === card.name)
      return finishInventoryCard(card, {
        connectedIp: activeSession?.['ip-address'] || activeSession?.address || '',
        sessionUptime: activeSession?.uptime || '',
      })
    }

    const activeSession = (activeHotspotSessions || []).find((s) => s.user === card.name)
    return finishInventoryCard(card, {
      connectedIp: activeSession?.address || '',
      sessionUptime: activeSession?.uptime || '',
    })
  })

  cards.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return {
    ...snapshot,
    cards,
    summary: computeInventorySummary(cards),
    fetchedAt: new Date().toISOString(),
  }
}

async function getCachedRouterInventory({ refresh = false, filterOptions = {} } = {}) {
  if (refresh) {
    const cardFilters = normalizeInventoryCardFilters(filterOptions)
    if (cardFilters.status === 'disabled') {
      return getDisabledRouterInventorySnapshot(filterOptions, { refresh: true })
    }
    if (hasActiveInventoryCardFilters(cardFilters)) {
      return getCachedRouterInventory({ refresh: false, filterOptions })
    }
    if (routerInventoryBuildPromise) return routerInventoryBuildPromise
    return ensureRouterInventoryBuild()
  }

  const now = Date.now()
  if (routerInventoryCache && now - routerInventoryCacheAt < ROUTER_INVENTORY_CACHE_MS) {
    return routerInventoryCache
  }
  return null
}

async function getFilteredRouterInventory(filterOptions = {}) {
  const refresh = filterOptions.refresh === true || filterOptions.refresh === '1'
  const cardFilters = normalizeInventoryCardFilters(filterOptions)
  const hasCardFilter = hasActiveInventoryCardFilters(cardFilters)

  if (refresh && cardFilters.status === 'disabled') {
    const snapshot = await getDisabledRouterInventorySnapshot(filterOptions, { refresh: true })
    const filtered = applyInventoryCardFilters(snapshot.cards, cardFilters)
    return { snapshot, filtered, cardFilters }
  }

  if (refresh && hasCardFilter) {
    const snapshot = await getCachedRouterInventory({ refresh: false, filterOptions })
    if (snapshot?.cards?.length) {
      const filtered = applyInventoryCardFilters(snapshot.cards, cardFilters)
      return { snapshot, filtered, cardFilters }
    }
    return { snapshot: null, filtered: [], cardFilters }
  }

  if (refresh && !hasCardFilter) {
    await getCachedRouterInventory({ refresh: true, filterOptions })
  } else if (!hasCardFilter && routerInventoryBuildPromise) {
    await routerInventoryBuildPromise
  }

  const snapshot = await getCachedRouterInventory({ refresh: false, filterOptions })
  if (!snapshot) {
    if (cardFilters.status === 'disabled' && disabledRouterInventoryCache?.cards?.length) {
      const filtered = applyInventoryCardFilters(disabledRouterInventoryCache.cards, cardFilters)
      return { snapshot: disabledRouterInventoryCache, filtered, cardFilters }
    }
    return { snapshot: null, filtered: [], cardFilters }
  }
  const filtered = applyInventoryCardFilters(snapshot.cards, cardFilters)
  return { snapshot, filtered, cardFilters }
}

function routerInventorySummary(filtered, snapshot, cardFilters) {
  const hasCardFilter = Boolean(cardFilters.status || cardFilters.source)
  if (!hasCardFilter && snapshot.summary && snapshot.cards.length === filtered.length) {
    return snapshot.summary
  }
  return computeInventorySummary(filtered)
}

async function getRouterInventoryChunk({ filter, offset, limit, filterOptions = {} }) {
  const { filtered, snapshot, cardFilters } = await getFilteredRouterInventory(filterOptions)
  if (!snapshot) {
    return {
      cards: [],
      summary: computeInventorySummary([]),
      period: filter.period,
      periodLabel: filter.periodLabel,
      truncated: false,
      progress: { loaded: 0, total: 0, percent: 100 },
      dbOnly: false,
      routerSource: true,
      cached: false,
      needsRefresh: true,
      sources: { hotspot: false, userManager: false },
      userManager: { available: false, customers: [], defaultCustomer: null, profiles: 0 },
      fetchedAt: new Date().toISOString(),
    }
  }
  const cap = getInventoryMaxCap()
  const routerTotal = filtered.length
  const total = Math.min(routerTotal, cap)
  const truncated = routerTotal > cap
  const safeOffset = Math.max(0, Number(offset) || 0)
  const safeLimit = Math.min(cap, Math.max(1, Number(limit) || total || routerTotal))
  const slice = filtered.slice(safeOffset, safeOffset + safeLimit)
  const loaded = Math.min(safeOffset + slice.length, total)

  return {
    cards: slice,
    summary: routerInventorySummary(filtered, snapshot, cardFilters),
    period: filter.period,
    periodLabel: filter.periodLabel,
    truncated,
    progress: {
      loaded,
      total,
      percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 100,
    },
    dbOnly: false,
    routerSource: true,
    cached: true,
    needsRefresh: false,
    sources: snapshot.sources,
    userManager: snapshot.userManager,
    fetchedAt: snapshot.fetchedAt,
  }
}

async function getPrintedCardsForPeriod(filterOptions = {}, { offset = 0, limit } = {}) {
  const filter = resolveInventoryFilter(filterOptions)
  const { clause, params } = buildInventoryWhere(filter)
  const safeOffset = Math.max(0, Number(offset) || 0)
  const maxCap = getInventoryMaxCap()
  const safeLimit = Math.min(maxCap, Math.max(1, Number(limit) || maxCap))
  const { rows } = await query(
    `SELECT c.id AS cardId, c.code, c.status AS dbStatus, b.category_name AS categoryName,
            b.printed_at AS printedAt, b.router_source AS routerSource,
            COALESCE(cat.router_profile, b.category_name) AS profile,
            a.name AS agentName
     FROM cards c
     INNER JOIN batches b ON b.id = c.batch_id
     LEFT JOIN categories cat ON cat.id = b.category_id
     LEFT JOIN agents a ON a.id = b.agent_id
     WHERE ${clause}
     ORDER BY b.printed_at DESC, c.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  )
  const countMeta = await countPrintedCardsForPeriod(filterOptions)
  return {
    rows,
    period: filter.period,
    periodLabel: filter.periodLabel,
    truncated: countMeta.truncated,
    total: countMeta.total,
    offset: safeOffset,
    limit: safeLimit,
  }
}

function computeInventorySummary(cards) {
  return {
    total: cards.length,
    available: cards.filter((c) => c.status === 'available').length,
    active: cards.filter((c) => c.status === 'active').length,
    expired: cards.filter((c) => c.status === 'expired').length,
    disabled: cards.filter((c) => c.status === 'disabled').length,
    profile_error: cards.filter((c) => c.status === 'profile_error').length,
    missing: cards.filter((c) => c.status === 'missing').length,
    hotspot: cards.filter((c) => c.source === ROUTER_SOURCE.HOTSPOT).length,
    userManager: cards.filter((c) => c.source === ROUTER_SOURCE.USER_MANAGER).length,
  }
}

async function fetchHotspotUsersIndexed(api, codeSet) {
  const activeSessions = await api.write('/ip/hotspot/active/print').catch(() => [])
  const activeUsernames = new Set(
    (activeSessions || []).map((s) => s.user).filter(Boolean)
  )

  const byName = new Map()
  const proplist = ['=.proplist=name,profile,comment,disabled,uptime,bytes-in,bytes-out']

  if (!codeSet.size) {
    return { byName, activeUsernames, activeSessions: activeSessions || [] }
  }

  try {
    const usersRaw = await printWithProplistFallback(api, '/ip/hotspot/user/print', HS_USER_PROPS[0])
    for (const u of usersRaw || []) {
      if (u.name && codeSet.has(u.name)) byName.set(u.name, mapHotspotUserRow(u))
    }
  } catch {
    // fall back to per-code lookup below
  }

  const unresolved = [...codeSet].filter((c) => !byName.has(c))
  if (unresolved.length > 0) {
    const batchSize = 30
    for (let i = 0; i < unresolved.length; i += batchSize) {
      await Promise.all(unresolved.slice(i, i + batchSize).map(async (code) => {
        try {
          const rows = await api.write('/ip/hotspot/user/print', [`?name=${code}`, ...proplist])
          if (rows?.[0]?.name) byName.set(rows[0].name, mapHotspotUserRow(rows[0]))
        } catch {
          // skip missing
        }
      }))
    }
  }

  return { byName, activeUsernames, activeSessions: activeSessions || [] }
}

function mapDbRowToPlaceholderCard(dbRow, statusLabel = 'جاري التحقق من الراوتر...') {
  const source = normalizeRouterSource(dbRow.routerSource)
  return finishInventoryCard({
    id: dbRow.code,
    serialNumber: dbRow.cardId != null ? String(dbRow.cardId) : '',
    name: dbRow.code,
    profile: dbRow.profile || dbRow.categoryName,
    comment: dbRow.categoryName,
    password: '',
    disabled: false,
    uptime: '',
    bytesIn: '',
    bytesOut: '',
    lastSeen: '',
    status: 'pending',
    statusLabel,
    connectedIp: '',
    sessionUptime: '',
    printedAt: dbRow.printedAt,
    dbStatus: dbRow.dbStatus,
    source,
    sourceLabel: routerSourceLabel(source),
    sourceLabelAr: routerSourceLabelAr(source),
  }, {
    pointOfSale: dbRow.agentName || '',
    packageLabel: dbRow.profile || dbRow.categoryName || '',
  })
}

const ROUTER_ENRICH_TIMEOUT_MS = 60000

function enrichDbRowsFromSnapshot(dbRows, snapshot) {
  const byName = new Map()
  for (const card of snapshot.cards || []) {
    if (card.name) byName.set(card.name, card)
  }

  const cards = []
  const missingCodes = []

  for (const dbRow of dbRows) {
    const routerCard = byName.get(dbRow.code)
    if (!routerCard) {
      missingCodes.push(dbRow.code)
      continue
    }
    cards.push({
      ...routerCard,
      printedAt: dbRow.printedAt,
      dbStatus: dbRow.dbStatus,
      serialNumber: dbRow.cardId != null ? String(dbRow.cardId) : (routerCard.serialNumber || ''),
      pointOfSale: dbRow.agentName || routerCard.pointOfSale || '',
    })
  }

  return { cards, missingCodes }
}

function lookupDbRowsWithRouterIndex(dbRows, { hotspotIndex, umIndex }) {
  const cards = []
  const missingCodes = []

  for (const dbRow of dbRows) {
    const source = normalizeRouterSource(dbRow.routerSource)
    const cardWithDate = {
      printedAt: dbRow.printedAt,
      dbStatus: dbRow.dbStatus,
      serialNumber: dbRow.cardId != null ? String(dbRow.cardId) : undefined,
      pointOfSale: dbRow.agentName || undefined,
    }

    if (source === ROUTER_SOURCE.USER_MANAGER) {
      const row = umIndex.byName.get(dbRow.code)
      if (!row) {
        missingCodes.push(dbRow.code)
        continue
      }
      cards.push({
        ...buildUserManagerInventoryCard(row, umIndex.profileNames, umIndex.sessions),
        ...cardWithDate,
      })
      continue
    }

    const row = hotspotIndex.byName.get(dbRow.code)
    if (!row) {
      missingCodes.push(dbRow.code)
      continue
    }
    cards.push({
      ...buildHotspotInventoryCard(row, hotspotIndex.profileNames, hotspotIndex.activeSessions),
      ...cardWithDate,
    })
  }

  return { cards, missingCodes }
}

async function enrichDbRowsWithRouterSafe(dbRows, options = {}) {
  try {
    return await Promise.race([
      enrichDbRowsWithRouter(dbRows, options),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('ROUTER_INVENTORY_TIMEOUT')), ROUTER_ENRICH_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (error.message === 'ROUTER_INVENTORY_TIMEOUT') {
      console.warn('[mikrotik] inventory enrich timeout — using cache fallback')

      if (routerEnrichmentIndex) {
        const { cards, missingCodes } = lookupDbRowsWithRouterIndex(dbRows, routerEnrichmentIndex)
        if (cards.length) {
          return {
            cards,
            purged: 0,
            sources: {
              hotspot: routerEnrichmentIndex.hotspotOk,
              userManager: routerEnrichmentIndex.userManagerAvailable && routerEnrichmentIndex.umOk,
            },
            userManager: {
              available: routerEnrichmentIndex.userManagerAvailable,
              customers: [],
              defaultCustomer: null,
              profiles: 0,
            },
            partial: true,
            missingCodes,
          }
        }
      }

      const snapshot = await getCachedRouterInventory({ refresh: false })
      if (snapshot) {
        const { cards, missingCodes } = enrichDbRowsFromSnapshot(dbRows, snapshot)
        if (cards.length) {
          return {
            cards,
            purged: 0,
            sources: snapshot.sources,
            userManager: snapshot.userManager,
            partial: true,
            missingCodes,
          }
        }
      }

      return {
        cards: dbRows.map((row) => mapDbRowToPlaceholderCard(row, 'تعذر الاتصال بالراوتر')),
        sources: { hotspot: false, userManager: false },
        userManager: { available: false, customers: [], defaultCustomer: null, profiles: 0 },
      }
    }
    throw error
  }
}

async function purgeStaleCardsFromDb(codes) {
  if (!codes?.length) return 0

  const unique = [...new Set(codes.filter(Boolean))]
  if (!unique.length) return 0

  const placeholders = unique.map((_, i) => `$${i + 1}`).join(', ')
  const { rows: batchRows } = await query(
    `SELECT DISTINCT batch_id AS batchId FROM cards WHERE code IN (${placeholders})`,
    unique
  )

  const { affectedRows } = await query(
    `DELETE FROM cards WHERE code IN (${placeholders})`,
    unique
  )

  for (const row of batchRows) {
    const batchId = row.batchId ?? row.batch_id
    if (!batchId) continue
    await query(
      'UPDATE batches SET `count` = (SELECT COUNT(*) FROM cards WHERE batch_id = $1) WHERE id = $1',
      [batchId]
    )
    const { rows: left } = await query(
      'SELECT COUNT(*) AS cnt FROM cards WHERE batch_id = $1',
      [batchId]
    )
    if (Number(left[0]?.cnt) === 0) {
      await query('DELETE FROM batches WHERE id = $1', [batchId])
    }
  }

  return affectedRows || unique.length
}

async function enrichDbRowsWithRouter(dbRows, { refresh = false } = {}) {
  if (!dbRows.length) {
    return {
      cards: [],
      sources: { hotspot: false, userManager: false },
      userManager: { available: false, customers: [], defaultCustomer: null, profiles: 0 },
    }
  }

  const refreshRequested = refresh === true || refresh === '1'
  let index = null

  await withConnection(async (api) => {
    index = await getRouterEnrichmentIndex(api, { refresh: refreshRequested })
  })

  const { cards, missingCodes } = lookupDbRowsWithRouterIndex(dbRows, index)

  let purged = 0
  if (missingCodes.length) {
    purged = await purgeStaleCardsFromDb(missingCodes)
    console.info(`[mikrotik] purged ${purged} card(s) missing from router:`, missingCodes.join(', '))
  }

  return {
    cards,
    purged,
    sources: {
      hotspot: index.hotspotOk,
      userManager: index.userManagerAvailable && index.umOk,
    },
    userManager: {
      available: index.userManagerAvailable,
      customers: [],
      defaultCustomer: null,
      profiles: 0,
    },
  }
}

async function fetchUserManagerUsersIndexed(api, codeSet) {
  const sessions = await api.write('/tool/user-manager/session/print').catch(() => [])
  const activeUsernames = new Set(
    (sessions || []).map((s) => s.user || s.username).filter(Boolean)
  )

  const byName = new Map()
  if (!codeSet.size) {
    return { byName, activeUsernames, sessions: sessions || [] }
  }

  try {
    const usersRaw = await printWithProplistFallback(api, '/tool/user-manager/user/print', UM_USER_PROPS)
    for (const u of usersRaw || []) {
      const name = u.username || u.name
      if (name && codeSet.has(name)) byName.set(name, mapUserManagerUserRow(u))
    }
  } catch {
    // fall back to per-code lookup below
  }

  const unresolved = [...codeSet].filter((c) => !byName.has(c))
  if (unresolved.length > 0) {
    const batchSize = 30
    for (let i = 0; i < unresolved.length; i += batchSize) {
      await Promise.all(unresolved.slice(i, i + batchSize).map(async (code) => {
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
  }

  return { byName, activeUsernames, sessions: sessions || [] }
}

function buildHotspotInventoryCard(row, validProfiles, activeSessions) {
  const { status, label } = resolveCardStatus(row, validProfiles)
  const activeSession = activeSessions.find((s) => s.user === row.name)
  return finishInventoryCard({
    ...row,
    status,
    statusLabel: label,
    connectedIp: activeSession?.address || '',
    sessionUptime: activeSession?.uptime || '',
    source: ROUTER_SOURCE.HOTSPOT,
    sourceLabel: routerSourceLabel(ROUTER_SOURCE.HOTSPOT),
    sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.HOTSPOT),
  })
}

function buildUserManagerInventoryCard(row, validProfiles, sessions, profileLimits = null) {
  const { status, label } = resolveUserManagerCardStatus(row, validProfiles, profileLimits)
  const activeSession = sessions.find((s) => (s.user || s.username) === row.name)
  return finishInventoryCard({
    ...row,
    status,
    statusLabel: label,
    connectedIp: activeSession?.['ip-address'] || activeSession?.address || '',
    sessionUptime: activeSession?.uptime || '',
    source: ROUTER_SOURCE.USER_MANAGER,
    sourceLabel: routerSourceLabel(ROUTER_SOURCE.USER_MANAGER),
    sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.USER_MANAGER),
  })
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
  const filterOptions = {
    period: options.period,
    date: options.date,
    month: options.month,
    status: options.status,
    source: options.source,
    refresh: options.refresh,
  }
  const offset = Math.max(0, Number(options.offset) || 0)
  const maxCap = getInventoryMaxCap()
  const limit = options.limit != null
    ? Math.min(maxCap, Math.max(1, Number(options.limit) || 500))
    : maxCap
  const dbOnly = options.dbOnly === true || options.dbOnly === '1'

  const filter = resolveInventoryFilter(filterOptions)
  if (filter.type === 'all') {
    return getRouterInventoryChunk({ filter, offset, limit, dbOnly, filterOptions })
  }

  const { rows: dbRows, truncated, total } = await getPrintedCardsForPeriod(
    filterOptions,
    { offset, limit }
  )

  const progressBase = {
    loaded: offset,
    total: total || 0,
    percent: total ? Math.min(100, Math.round((offset / total) * 100)) : 100,
  }

  if (!dbRows.length) {
    return {
      cards: [],
      summary: computeInventorySummary([]),
      period: filter.period,
      periodLabel: filter.periodLabel,
      truncated: Boolean(truncated),
      progress: progressBase,
      dbOnly,
      sources: { hotspot: false, userManager: false },
      userManager: { available: false, customers: [], defaultCustomer: null, profiles: 0 },
      fetchedAt: new Date().toISOString(),
    }
  }

  if (dbOnly) {
    const cards = dbRows.map((row) => mapDbRowToPlaceholderCard(row))
    const loaded = Math.min(offset + cards.length, total || offset + cards.length)
    return {
      cards,
      summary: computeInventorySummary(cards),
      period: filter.period,
      periodLabel: filter.periodLabel,
      truncated: Boolean(truncated),
      progress: {
        loaded,
        total: total || loaded,
        percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 100,
      },
      dbOnly: true,
      sources: { hotspot: false, userManager: false },
      userManager: { available: false, customers: [], defaultCustomer: null, profiles: 0 },
      fetchedAt: new Date().toISOString(),
    }
  }

  try {
    const enriched = await enrichDbRowsWithRouterSafe(dbRows, { refresh: options.refresh })
    const cardFilters = normalizeInventoryCardFilters(filterOptions)
    const cards = applyInventoryCardFilters(enriched.cards, cardFilters)
    const loaded = Math.min(offset + cards.length, total || offset + cards.length)
    const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : 100

    return {
      cards,
      summary: computeInventorySummary(cards),
      period: filter.period,
      periodLabel: filter.periodLabel,
      truncated: Boolean(truncated),
      progress: { loaded, total: total || loaded, percent },
      dbOnly: false,
      sources: enriched.sources,
      userManager: enriched.userManager,
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.warn('[mikrotik] inventory period fetch failed:', error.message)
    throw error
  }
}

export async function syncAgentPendingCardsWithRouter(agentId) {
  const { rows } = await query(
    `SELECT c.code, b.router_source AS routerSource
     FROM cards c
     INNER JOIN batches b ON b.id = c.batch_id
     WHERE b.agent_id = $1 AND c.status = 'معلق'`,
    [agentId]
  )
  if (!rows.length) return { purged: 0 }

  const codesBySource = { hotspot: new Set(), 'user-manager': new Set() }
  for (const row of rows) {
    const source = normalizeRouterSource(row.routerSource)
    const key = source === ROUTER_SOURCE.USER_MANAGER ? 'user-manager' : 'hotspot'
    codesBySource[key].add(row.code)
  }

  const missingCodes = []

  await withConnection(async (api) => {
    if (codesBySource.hotspot.size > 0) {
      const idx = await fetchHotspotUsersIndexed(api, codesBySource.hotspot)
      for (const code of codesBySource.hotspot) {
        if (!idx.byName.has(code)) missingCodes.push(code)
      }
    }
    if (codesBySource['user-manager'].size > 0) {
      try {
        const idx = await fetchUserManagerUsersIndexed(api, codesBySource['user-manager'])
        for (const code of codesBySource['user-manager']) {
          if (!idx.byName.has(code)) missingCodes.push(code)
        }
      } catch (error) {
        if (!isUserManagerUnavailable(error)) throw error
      }
    }
  })

  const purged = missingCodes.length ? await purgeStaleCardsFromDb(missingCodes) : 0
  if (purged) {
    console.info(`[mikrotik] agent ${agentId}: purged ${purged} stale pending card(s)`)
  }
  return { purged, missingCodes }
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

  const { rows } = await query(
    'SELECT id FROM categories WHERE router_profile = $1 AND router_source = $2 LIMIT 1',
    [name, normalizedSource]
  )

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

async function reconcileRouterSourceLabels(umProfileNames, hotspotProfileNames) {
  const umSet = new Set(umProfileNames)
  const hsSet = new Set(hotspotProfileNames)
  let fixed = 0

  const { rows } = await query(
    `SELECT id, router_profile AS routerProfile FROM categories
     WHERE router_source = 'user-manager' AND router_profile IS NOT NULL`
  )

  for (const row of rows) {
    if (umSet.has(row.routerProfile)) continue

    const revertToHotspot = hsSet.has(row.routerProfile)
    if (!revertToHotspot) continue

    const { affectedRows } = await query(
      `UPDATE categories SET router_source = 'hotspot'
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM batches b
           WHERE b.category_id = $1 AND b.router_source = 'user-manager'
         )`,
      [row.id]
    )
    fixed += affectedRows || 0
  }

  return fixed
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
    ? await reconcileRouterSourceLabels(umProfileNames, profiles.map((p) => p.name))
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

export async function pushUserManagerUsers({ profile, codes, entries, customer }) {
  const profileName = profile
  const cardEntries = entries?.length
    ? entries
    : (codes || []).map((code) => ({ username: code, password: code }))

  if (!profileName || !cardEntries.length) {
    throw new Error('بروفايل User Manager والأكواد مطلوبان')
  }

  return withConnection(async (api) => {
    const cust = await resolveUserManagerCustomer(api, customer)

    for (const { username, password } of cardEntries) {
      let added = false
      for (let attempt = 0; attempt < 5 && !added; attempt += 1) {
        try {
          const addArgs = [
            `=username=${username}`,
            `=password=${password}`,
            `=customer=${cust}`,
          ]
          await api.write('/tool/user-manager/user/add', addArgs)
          await api.write('/tool/user-manager/user/create-and-activate-profile', [
            `=customer=${cust}`,
            `=numbers=${username}`,
            `=profile=${profileName}`,
          ])
          added = true
        } catch (error) {
          if (attempt === 4) throw error
        }
      }
    }

    const [hotspotCount, umCount] = await Promise.all([
      printCount(api, '/ip/hotspot/user/print').catch(() => 0),
      printCount(api, '/tool/user-manager/user/print').catch(() => 0),
    ])
    const liveCount = hotspotCount + umCount
    await query('UPDATE mikrotik_routers SET cards_printed = $1', [liveCount])

    return { added: cardEntries.length, totalOnRouter: liveCount, userManagerTotal: umCount, customer: cust }
  })
}

export async function pushRouterUsers({ source, profile, codes, entries }) {
  const normalizedSource = normalizeRouterSource(source)
  if (normalizedSource === ROUTER_SOURCE.USER_MANAGER) {
    return pushUserManagerUsers({ profile, codes, entries })
  }
  return pushHotspotUsers({ profile, codes, entries })
}

export async function pushHotspotUsers({ profile, codes, entries }) {
  const profileName = profile
  const cardEntries = entries?.length
    ? entries
    : (codes || []).map((code) => ({ username: code, password: code }))

  if (!profileName || !cardEntries.length) {
    throw new Error('بروفايل الراوتر والأكواد مطلوبان')
  }

  return withConnection(async (api) => {
    for (const { username, password } of cardEntries) {
      let added = false
      for (let attempt = 0; attempt < 5 && !added; attempt += 1) {
        try {
          await api.write('/ip/hotspot/user/add', [
            `=name=${username}`,
            `=password=${password}`,
            `=profile=${profileName}`,
          ])
          added = true
        } catch (error) {
          if (attempt === 4) throw error
        }
      }
    }

    const [hotspotCount, umCount] = await Promise.all([
      printCount(api, '/ip/hotspot/user/print').catch(() => 0),
      printCount(api, '/tool/user-manager/user/print').catch(() => 0),
    ])
    const liveCount = hotspotCount + umCount
    await query('UPDATE mikrotik_routers SET cards_printed = $1', [liveCount])

    return { added: cardEntries.length, totalOnRouter: liveCount }
  })
}
