import { Router } from 'express'
import { requireGatewayAuth } from '../middleware/gatewayAuth.js'
import { gatewayRequestRateLimit } from '../middleware/gatewayRateLimit.js'
import { gatewaySecurityHeaders } from '../middleware/gatewaySecurityHeaders.js'
import * as smsGatewayService from '../services/sms-gateway.service.js'
import { parsePositiveInt } from '../utils/validateId.js'

const router = Router()

router.use(gatewaySecurityHeaders)
router.use(gatewayRequestRateLimit)
router.use(requireGatewayAuth)

router.get('/stats', async (_req, res) => {
  try {
    await smsGatewayService.touchGatewayHeartbeat()
    const stats = await smsGatewayService.getGatewayStats()
    res.json({ stats })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب الإحصائيات' })
  }
})

router.get('/pending', async (req, res) => {
  try {
    await smsGatewayService.touchGatewayHeartbeat()
    const messages = await smsGatewayService.getPendingSms(req.query.limit)
    res.json({ messages })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب الرسائل' })
  }
})

router.post('/:id/sent', async (req, res) => {
  const id = parsePositiveInt(req.params.id)
  if (!id) return res.status(400).json({ message: 'معرّف غير صالح' })

  try {
    const row = await smsGatewayService.markSmsSent(id)
    if (!row) return res.status(404).json({ message: 'الرسالة غير موجودة' })
    res.json({ ok: true, message: row })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر تحديث الحالة' })
  }
})

router.post('/:id/failed', async (req, res) => {
  const id = parsePositiveInt(req.params.id)
  if (!id) return res.status(400).json({ message: 'معرّف غير صالح' })

  try {
    const row = await smsGatewayService.markSmsFailed(id, req.body?.error)
    if (!row) return res.status(404).json({ message: 'الرسالة غير موجودة' })
    res.json({ ok: true, message: row })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر تحديث الحالة' })
  }
})

export default router
