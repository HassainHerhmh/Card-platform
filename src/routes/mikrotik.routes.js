import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getRouterStatus, printHotspotUsers } from '../services/mikrotik.service.js'
import { routers } from '../data/store.js'

const router = Router()

router.use(requireAuth)

router.get('/routers', async (_req, res) => {
  const status = await getRouterStatus()
  res.json({
    routers: routers.map((r) => ({
      ...r,
      status: status.connected ? 'متصل' : 'غير متصل',
    })),
  })
})

router.get('/status', async (_req, res) => {
  const status = await getRouterStatus()
  res.json(status)
})

router.post('/print', async (req, res) => {
  const { category, count } = req.body
  if (!category || !count) {
    return res.status(400).json({ message: 'الفئة وعدد الكروت مطلوبان' })
  }

  const result = await printHotspotUsers({ profiles: category, count: Number(count) })
  res.json(result)
})

export default router
