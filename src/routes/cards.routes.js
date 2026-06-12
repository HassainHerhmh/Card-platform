import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)

router.get('/batches', (_req, res) => {
  res.json({ batches: [] })
})

export default router
