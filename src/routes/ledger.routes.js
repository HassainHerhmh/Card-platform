import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as ledgerService from '../services/ledger.service.js'

const router = Router()
router.use(requireAuth)

router.post('/receipt', async (req, res) => {
  try {
    const { agentId, amount, date, notes } = req.body
    if (!agentId) return res.status(400).json({ message: 'الوكيل مطلوب' })
    const entry = await ledgerService.createReceiptVoucher({
      agentId: +agentId,
      amount,
      date,
      notes,
    })
    res.status(201).json({ ok: true, entry })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر حفظ سند القبض' })
  }
})

router.post('/payment', async (req, res) => {
  try {
    const { agentId, amount, date, notes } = req.body
    if (!agentId) return res.status(400).json({ message: 'الوكيل مطلوب' })
    const entry = await ledgerService.createPaymentVoucher({
      agentId: +agentId,
      amount,
      date,
      notes,
    })
    res.status(201).json({ ok: true, entry })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر حفظ سند الصرف' })
  }
})

router.get('/statement', async (req, res) => {
  try {
    const { agentId, from, to } = req.query
    if (!agentId) return res.status(400).json({ message: 'الوكيل مطلوب' })
    const statement = await ledgerService.getAccountStatement({
      agentId: +agentId,
      fromDate: from || null,
      toDate: to || null,
    })
    res.json({ statement })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر جلب كشف الحساب' })
  }
})

router.get('/vouchers/:type', async (req, res) => {
  try {
    const type = req.params.type === 'payment' ? 'سند صرف' : 'سند قبض'
    const vouchers = await ledgerService.getRecentVouchers(type, req.query.limit)
    res.json({ vouchers })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب السندات' })
  }
})

export default router
