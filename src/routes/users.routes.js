import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { users } from '../data/store.js'

const router = Router()

router.use(requireAuth)

router.get('/', (_req, res) => {
  res.json({ users })
})

export default router
