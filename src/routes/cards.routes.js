import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as cardsService from '../services/cards.service.js'
import { syncMissingBatchJournals } from '../services/ledger.service.js'

const router = Router()
router.use(requireAuth)

router.get('/batches', async (_req, res) => {
  try {
    const batches = await cardsService.getBatches()
    res.json({ batches })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب الدفعات' })
  }
})

router.post('/batches/sync-journals', async (_req, res) => {
  try {
    const results = await syncMissingBatchJournals({ limit: 500 })
    res.json({ results })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر مزامنة قيود الدفعات' })
  }
})

router.post('/batches', async (req, res) => {
  try {
    const { categoryId, count, agentId, cardPrefix, cardSuffix, cardFormat } = req.body
    const batch = await cardsService.createBatch({
      categoryId: +categoryId,
      count: +count,
      agentId: agentId ? +agentId : null,
      cardPrefix: cardPrefix || '',
      cardSuffix: cardSuffix || '',
      cardFormat: cardFormat || 'empty_password',
    })
    res.status(201).json({ batch })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر إنشاء الدفعة' })
  }
})

export default router
