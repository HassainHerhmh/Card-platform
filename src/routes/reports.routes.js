import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as reportsService from '../services/reports.service.js'

const router = Router()
router.use(requireAuth)

router.get('/sales', async (_req, res) => {
  try {
    const salesReport = await reportsService.getSalesReport()
    res.json({ salesReport })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب التقارير' })
  }
})

router.get('/dashboard', async (_req, res) => {
  try {
    const stats = await reportsService.getDashboardStats()
    res.json(stats)
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب إحصائيات لوحة التحكم' })
  }
})

export default router
