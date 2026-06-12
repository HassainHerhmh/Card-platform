import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as cardsService from '../services/cards.service.js'

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

router.post('/batches', async (req, res) => {
  try {
    const { categoryId, count, agentId } = req.body
    const batch = await cardsService.createBatch({
      categoryId: +categoryId,
      count: +count,
      agentId: agentId ? +agentId : null,
    })
    res.status(201).json({ batch })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر إنشاء الدفعة' })
  }
})

export default router
