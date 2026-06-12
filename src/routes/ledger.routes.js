import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as ledgerService from '../services/ledger.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (_req, res) => {
  try {
    const ledger = await ledgerService.getLedger()
    res.json({ ledger })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب دفتر الحسابات' })
  }
})

export default router
