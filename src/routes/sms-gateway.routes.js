import { Router } from 'express'
import { requireGatewayAuth } from '../middleware/gatewayAuth.js'
import * as smsGatewayService from '../services/sms-gateway.service.js'

const router = Router()
router.use(requireGatewayAuth)

router.get('/stats', async (_req, res) => {
  try {
    const stats = await smsGatewayService.getGatewayStats()
    res.json({ stats })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب إحصائيات البوابة' })
  }
})

router.get('/pending', async (req, res) => {
  try {
    const messages = await smsGatewayService.getPendingSms(req.query.limit)
    res.json({ messages })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب الرسائل المعلقة' })
  }
})

router.post('/:id/sent', async (req, res) => {
  try {
    const row = await smsGatewayService.markSmsSent(+req.params.id)
    if (!row) return res.status(404).json({ message: 'الرسالة غير موجودة أو مُرسلة مسبقاً' })
    res.json({ ok: true, message: row })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر تحديث حالة الرسالة' })
  }
})

router.post('/:id/failed', async (req, res) => {
  try {
    const row = await smsGatewayService.markSmsFailed(+req.params.id, req.body?.error)
    if (!row) return res.status(404).json({ message: 'الرسالة غير موجودة' })
    res.json({ ok: true, message: row })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر تحديث حالة الرسالة' })
  }
})

export default router
