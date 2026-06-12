import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../db/pool.js'
import { getRouterStatus, printHotspotUsers } from '../services/mikrotik.service.js'

const router = Router()
router.use(requireAuth)

router.get('/routers', async (_req, res) => {
  try {
    const status = await getRouterStatus()
    const { rows } = await query('SELECT id, name, ip, cards_printed AS cardsPrinted FROM mikrotik_routers ORDER BY id')
    res.json({
      routers: rows.map((r) => ({
        ...r,
        status: status.connected ? 'متصل' : 'غير متصل',
      })),
    })
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
