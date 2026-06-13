import { RouterOSAPI } from 'node-routeros'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import {
  ROUTER_SOURCE,
  normalizeRouterSource,
  routerSourceLabel,
  routerSourceLabelAr,
} from '../constants/routerSource.js'

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
      let userManagerUsers = 0
      let activeUserManagerSessions = 0
      let userManager = {
        available: false,
        customers: [],
        defaultCustomer: null,
        profiles: 0,
      }

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
      try {
        const um = await fetchUserManagerSnapshot(api)
        userManagerUsers = um.users.length
        activeUserManagerSessions = um.sessions.length
        userManager = {
          available: true,
          customers: um.customers.map((c) => ({
            login: customerLogin(c),
            name: c.name,
          })),
          defaultCustomer: um.defaultCustomer,
          profiles: um.profiles.length,
        }
      } catch {
        userManagerUsers = 0
        activeUserManagerSessions = 0
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

  const customers = (customersRaw || []).map(mapUserManagerCustomerRow)
  const users = (usersRaw || []).map(mapUserManagerUserRow)
  const profiles = (profilesRaw || []).map((p) => ({
    id: p['.id'],
    name: p.name,
    validity: p.validity || '',
    price: p.price || '',
    owner: p.owner || '',
    nameForUsers: p['name-for-users'] || '',
  }))
  const defaultCustomer = pickDefaultUserManagerCustomer(customers, users)

  return {
    customers,
    users,
    profiles,
    sessions: sessionsRaw || [],
    defaultCustomer,
  }
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
    const profiles = await api.write('/tool/user-manager/profile/print')
    return (profiles || []).map((p) => ({
      id: p['.id'],
      name: p.name,
      validity: p.validity || '',
      price: p.price || '',
      owner: p.owner || '',
      nameForUsers: p['name-for-users'] || '',
    }))
  })
}

function umProfileDuration(profile) {
  return profile.validity || '24 ساعة'
}

function umProfileDataQuota(profile) {
  return profile.nameForUsers || profile.price || '1 جيجا'
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

export async function getCombinedInventory() {
  let hotspotResult = null
  let userManagerResult = null
  let userManagerAvailable = true

  try {
    hotspotResult = await getHotspotInventory()
  } catch (error) {
    console.warn('[mikrotik] hotspot inventory failed:', error.message)
  }

  try {
    userManagerResult = await getUserManagerInventory()
  } catch (error) {
    if (isUserManagerUnavailable(error)) {
      userManagerAvailable = false
    } else {
      console.warn('[mikrotik] user-manager inventory failed:', error.message)
    }
  }

  const hotspotCards = (hotspotResult?.cards || []).map((card) => ({
    ...card,
    source: ROUTER_SOURCE.HOTSPOT,
    sourceLabel: routerSourceLabel(ROUTER_SOURCE.HOTSPOT),
    sourceLabelAr: routerSourceLabelAr(ROUTER_SOURCE.HOTSPOT),
  }))

  const userManagerCards = userManagerResult?.cards || []

  const cards = [...hotspotCards, ...userManagerCards].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )

  const summary = {
    total: cards.length,
    available: cards.filter((c) => c.status === 'available').length,
    connected: cards.filter((c) => c.status === 'connected').length,
    expired: cards.filter((c) => c.status === 'expired').length,
    disabled: cards.filter((c) => c.status === 'disabled').length,
    hotspot: hotspotCards.length,
    userManager: userManagerCards.length,
  }

  return {
    cards,
    summary,
    sources: {
      hotspot: Boolean(hotspotResult),
      userManager: userManagerAvailable && Boolean(userManagerResult),
    },
    userManager: userManagerResult?.userManager || {
      available: userManagerAvailable && Boolean(userManagerResult),
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

async function upsertCategoryFromProfile({ name, duration, dataQuota, source }) {
  const normalizedSource = normalizeRouterSource(source)
  const { rows } = await query(
    'SELECT id FROM categories WHERE router_profile = $1 AND router_source = $2 LIMIT 1',
    [name, normalizedSource]
  )

  if (rows[0]) {
    await query(
      `UPDATE categories
       SET name = $1, duration = $2, data_quota = $3, router_profile = $4, router_source = $5
       WHERE id = $6`,
      [name, duration, dataQuota, name, normalizedSource, rows[0].id]
    )
    return { action: 'updated', name, source: normalizedSource }
  }

  await query(
    `INSERT INTO categories (name, price, duration, data_quota, router_profile, router_source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [name, 0, duration, dataQuota, name, normalizedSource]
  )
  return { action: 'created', name, source: normalizedSource }
}

export async function syncAllFromRouter() {
  const [profiles, hotspotUsers] = await Promise.all([
    getHotspotProfiles(),
    getHotspotUsers(),
  ])

  let umProfiles = []
  let umUsers = []
  let umCustomers = []
  let umDefaultCustomer = null
  let userManagerAvailable = true
  try {
    const um = await fetchUserManagerFromRouter()
    umProfiles = um.profiles
    umUsers = um.users
    umCustomers = um.customers
    umDefaultCustomer = um.defaultCustomer
  } catch (error) {
    userManagerAvailable = !isUserManagerUnavailable(error)
    if (userManagerAvailable) {
      console.warn('[mikrotik] user-manager sync skipped:', error.message)
    }
  }

  const deletedManual = await deleteManualCategories()
  const profileNames = profiles.map((p) => p.name)
  const umProfileNames = umProfiles.map((p) => p.name)
  const deletedStaleHotspot = await deleteStaleRouterCategories(profileNames, ROUTER_SOURCE.HOTSPOT)
  const deletedStaleUm = userManagerAvailable
    ? await deleteStaleRouterCategories(umProfileNames, ROUTER_SOURCE.USER_MANAGER)
    : 0

  const categoryResults = []
  for (const profile of profiles) {
    categoryResults.push(await upsertCategoryFromProfile({
      name: profile.name,
      duration: profileDuration(profile),
      dataQuota: profileDataQuota(profile),
      source: ROUTER_SOURCE.HOTSPOT,
    }))
  }

  if (userManagerAvailable) {
    for (const profile of umProfiles) {
      categoryResults.push(await upsertCategoryFromProfile({
        name: profile.name,
        duration: umProfileDuration(profile),
        dataQuota: umProfileDataQuota(profile),
        source: ROUTER_SOURCE.USER_MANAGER,
      }))
    }
  }

  const inferred = inferCardCodeSettings([
    ...hotspotUsers.map((u) => u.name),
    ...umUsers.map((u) => u.name),
  ])
  let cardSettings = null
  if (inferred) {
    await query(
      `INSERT INTO card_settings (id, digits, chars) VALUES (1, $1, $2)
       ON DUPLICATE KEY UPDATE digits = VALUES(digits), chars = VALUES(chars)`,
      [inferred.digits, inferred.chars]
    )
    cardSettings = inferred
  }

  const totalCards = hotspotUsers.length + umUsers.length
  await syncRouterCardsCount(totalCards)

  return {
    categories: {
      synced: categoryResults.length,
      deletedManual,
      deletedStale: deletedStaleHotspot + deletedStaleUm,
      profiles: categoryResults,
    },
    cardSettings,
    hotspotUsers: hotspotUsers.length,
    userManagerUsers: umUsers.length,
    totalCards,
    userManagerAvailable,
    userManager: {
      available: userManagerAvailable && umProfiles.length + umUsers.length + umCustomers.length > 0,
      customers: umCustomers.map((c) => ({
        login: customerLogin(c),
        name: c.name,
      })),
      defaultCustomer: umDefaultCustomer,
      profiles: umProfiles.length,
    },
    usersSample: [
      ...hotspotUsers.slice(0, 5).map((u) => ({ name: u.name, profile: u.profile, source: ROUTER_SOURCE.HOTSPOT })),
      ...umUsers.slice(0, 5).map((u) => ({ name: u.name, profile: u.profile, source: ROUTER_SOURCE.USER_MANAGER })),
    ],
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
