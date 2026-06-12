import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as agentsService from '../services/agents.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (_req, res) => {
  try {
    const agents = await agentsService.getAgents()
    res.json({ agents })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب الوكلاء' })
  }
})

router.post('/', async (req, res) => {
  try {
    const agent = await agentsService.createAgent(req.body)
    res.status(201).json({ agent })
  } catch (error) {
    res.status(500).json({ message: 'تعذر إضافة الوكيل' })
  }
})

export default router
