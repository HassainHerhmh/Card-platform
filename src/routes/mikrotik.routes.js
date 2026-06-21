import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/pool.js'
import {
  getRouterStatus,
  getHotspotProfiles,
  getHotspotUsers,
  getCombinedInventory,
  getInventoryCount,
  getRouterInventorySyncProgress,
  getUserManagerProfiles,
  getUserManagerCustomers,
  syncRouterCardsCount,
  diagnoseUserManagerLimits,
  syncAllFromRouter,
  getActiveUsers,
} from '../services/mikrotik.service.js'

const router = Router()
router.use(requireAuth)

router.get('/routers', async (_req, res) => {
  try {
    const status = await getRouterStatus()
    const liveCount = status.totalCards ?? status.hotspotUsers ?? 0
    if (status.connected) {
      await syncRouterCardsCount(liveCount)
    }

    const { rows } = await query(
      'SELECT id, name, ip, cards_printed AS cardsPrinted FROM mikrotik_routers ORDER BY id LIMIT 1'
    )
    const main = rows[0]

    const routers = main
      ? [{
          ...main,
          name: status.identity || main.name,
          ip: status.host || main.ip,
          status: status.connected ? 'متصل' : 'غير متصل',
          version: status.version,
          boardName: status.boardName,
          hotspotUsers: status.hotspotUsers ?? 0,
          userManagerUsers: status.userManagerUsers ?? 0,
          totalCards: liveCount,
          activeHotspotUsers: status.activeHotspotUsers ?? 0,
          activeUserManagerSessions: status.activeUserManagerSessions ?? 0,
          cardsPrinted: liveCount,
        }]
      : status.host
        ? [{
            id: 0,
            name: status.identity || 'MikroTik',
            ip: status.host,
            cardsPrinted: liveCount,
            status: status.connected ? 'متصل' : 'غير متصل',
            version: status.version,
            boardName: status.boardName,
            hotspotUsers: status.hotspotUsers ?? 0,
            userManagerUsers: status.userManagerUsers ?? 0,
            totalCards: liveCount,
            activeHotspotUsers: status.activeHotspotUsers ?? 0,
            activeUserManagerSessions: status.activeUserManagerSessions ?? 0,
          }]
        : []

    res.json({ routers, connection: status })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب الراوترات' })
  }
})

router.get('/status', async (_req, res) => {
  try {
    const status = await getRouterStatus()
    if (status.connected) {
      await syncRouterCardsCount(status.totalCards ?? status.hotspotUsers ?? 0)
    }
    res.json(status)
  } catch (error) {
    res.status(500).json({ message: 'تعذر فحص حالة الميكروتك' })
  }
})

router.get('/profiles', async (_req, res) => {
  try {
    const profiles = await getHotspotProfiles()
    res.json({ profiles })
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب بروفايلات الهوتسبوت' })
  }
})

router.get('/inventory/sync-progress', async (_req, res) => {
  try {
    res.json(getRouterInventorySyncProgress())
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب تقدّم المزامنة' })
  }
})

router.get('/inventory/count', async (req, res) => {
  try {
    const filter = {
      period: req.query.period || 'day',
      date: req.query.date || '',
      month: req.query.month || '',
      status: req.query.status || '',
      source: req.query.source || '',
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
    }
    const meta = await getInventoryCount(filter)
    res.json(meta)
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر عدّ كروت الفترة' })
  }
})

router.get('/inventory', async (req, res) => {
  try {
    const filter = {
      period: req.query.period || 'day',
      date: req.query.date || '',
      month: req.query.month || '',
      status: req.query.status || '',
      source: req.query.source || '',
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
    }
    const offset = req.query.offset != null ? Number(req.query.offset) : 0
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined
    const dbOnly = req.query.dbOnly === '1' || req.query.dbOnly === 'true'
    const inventory = await getCombinedInventory({ ...filter, offset, limit, dbOnly })
    res.json(inventory)
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب مخزون الكروت من الراوتر' })
  }
})

router.get('/user-manager/diagnostics', async (_req, res) => {
  try {
    const report = await diagnoseUserManagerLimits()
    res.json(report)
  } catch (error) {
    console.error('[um-diagnostics]', error)
    res.status(502).json({
      ok: false,
      message: error.message || 'تعذر تشخيص وقت User Manager',
      globalIssues: [error.message || 'خطأ غير معروف'],
    })
  }
})

router.get('/user-manager/profiles', async (_req, res) => {
  try {
    const profiles = await getUserManagerProfiles()
    res.json({ profiles })
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب بروفايلات User Manager' })
  }
})

router.get('/user-manager/customers', async (_req, res) => {
  try {
    const data = await getUserManagerCustomers()
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب عملاء User Manager من الراوتر' })
  }
})

router.get('/active-users', async (req, res) => {
  try {
    const data = await getActiveUsers({ source: req.query.source || 'all' })
    res.json(data)
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب المستخدمين النشطين' })
  }
})

router.get('/users', async (_req, res) => {
  try {
    const users = await getHotspotUsers()
    res.json({ users, count: users.length })
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب كروت الهوتسبوت من الراوتر' })
  }
})

router.post('/sync', async (_req, res) => {
  try {
    const result = await syncAllFromRouter()
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب البيانات من الراوتر' })
  }
})

router.post('/sync-categories', async (_req, res) => {
  try {
    const result = await syncAllFromRouter()
    res.json({
      synced: result.categories.synced,
      profiles: result.categories.profiles,
      deletedManual: result.categories.deletedManual,
      deletedStale: result.categories.deletedStale,
      cardSettings: result.cardSettings,
    })
  } catch (error) {
    console.error(error)
    res.status(502).json({ message: error.message || 'تعذر جلب البيانات من الراوتر' })
  }
})

export default router
