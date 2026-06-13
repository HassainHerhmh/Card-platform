import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/pool.js'
import {
  getRouterStatus,
  getHotspotProfiles,
  getHotspotUsers,
  syncRouterCardsCount,
  syncAllFromRouter,
} from '../services/mikrotik.service.js'

const router = Router()
router.use(requireAuth)

router.get('/routers', async (_req, res) => {
  try {
    const status = await getRouterStatus()
    const liveCount = status.hotspotUsers ?? 0
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
          hotspotUsers: liveCount,
          activeHotspotUsers: status.activeHotspotUsers ?? 0,
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
            hotspotUsers: liveCount,
            activeHotspotUsers: status.activeHotspotUsers ?? 0,
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
      await syncRouterCardsCount(status.hotspotUsers ?? 0)
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
