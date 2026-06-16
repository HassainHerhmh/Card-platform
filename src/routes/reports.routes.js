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

router.get('/comprehensive', async (req, res) => {
  try {
    const report = await reportsService.getComprehensivePrintReport({
      period: req.query.period,
      date: req.query.date,
      month: req.query.month,
      source: req.query.source,
    })
    res.json({ report })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب التقرير الشامل' })
  }
})

export default router
