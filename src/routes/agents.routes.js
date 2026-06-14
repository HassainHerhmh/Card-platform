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
    const { name, phone, address, password, devices, accountId } = req.body

    if (!name?.trim()) {
      return res.status(400).json({ message: 'اسم الوكيل مطلوب' })
    }
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'رقم الجوال مطلوب' })
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' })
    }
    if (!accountId) {
      return res.status(400).json({ message: 'الحساب المحاسبي مطلوب' })
    }

    const agent = await agentsService.createAgent({
      name: name.trim(),
      phone: phone.trim(),
      address: address?.trim() || '',
      password,
      devices,
      accountId: accountId ? +accountId : null,
    })
    res.status(201).json({ agent })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'تعذر إضافة الوكيل' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const { name, phone, address, devices, accountId } = req.body

    if (!name?.trim()) {
      return res.status(400).json({ message: 'اسم الوكيل مطلوب' })
    }
    if (!phone?.trim()) {
      return res.status(400).json({ message: 'رقم الجوال مطلوب' })
    }
    if (!accountId) {
      return res.status(400).json({ message: 'الحساب المحاسبي مطلوب' })
    }

    const agent = await agentsService.updateAgent(+req.params.id, {
      name: name.trim(),
      phone: phone.trim(),
      address: address?.trim() || '',
      devices,
      accountId: accountId ? +accountId : null,
    })
    if (!agent) return res.status(404).json({ message: 'الوكيل غير موجود' })
    res.json({ agent })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'تعذر تحديث الوكيل' })
  }
})

router.put('/:id/password', async (req, res) => {
  try {
    const password = await agentsService.resetAgentPassword(+req.params.id)
    res.json({ ok: true, password })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر توليد كلمة المرور' })
  }
})

router.put('/:id/toggle-status', async (req, res) => {
  try {
    const agent = await agentsService.toggleAgentStatus(+req.params.id)
    if (!agent) return res.status(404).json({ message: 'الوكيل غير موجود' })
    res.json({ agent })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر تغيير حالة الوكيل' })
  }
})

export default router
