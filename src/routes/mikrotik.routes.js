import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/pool.js'
import { getRouterStatus, getHotspotProfiles, printHotspotUsers } from '../services/mikrotik.service.js'

const router = Router()
router.use(requireAuth)

router.get('/routers', async (_req, res) => {
  try {
    const status = await getRouterStatus()
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
          hotspotUsers: status.hotspotUsers,
        }]
      : status.host
        ? [{
            id: 0,
            name: status.identity || 'MikroTik',
            ip: status.host,
            cardsPrinted: 0,
            status: status.connected ? 'متصل' : 'غير متصل',
            version: status.version,
            boardName: status.boardName,
            hotspotUsers: status.hotspotUsers,
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

router.post('/print', async (req, res) => {
  try {
    const { category, count } = req.body
    if (!category || !count) {
      return res.status(400).json({ message: 'الفئة وعدد الكروت مطلوبان' })
    }
    const result = await printHotspotUsers({ profiles: category, count: Number(count) })
    res.json(result)
  } catch (error) {
    res.status(500).json({ message: 'تعذر الطباعة من الميكروتك' })
  }
})

export default router
