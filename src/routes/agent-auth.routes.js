import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import * as agentsService from '../services/agents.service.js'

const router = Router()

router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body
    if (!phone?.trim() || !password) {
      return res.status(400).json({ message: 'رقم الجوال وكلمة المرور مطلوبان' })
    }

    const agent = await agentsService.findByPhone(phone.trim())
    if (!agent || agent.status !== 'نشط') {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة أو الحساب موقوف' })
    }

    const valid = await agentsService.verifyPassword(agent, password)
    if (!valid) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    const token = jwt.sign(
      { id: agent.id, phone: agent.phone, type: 'agent' },
      env.jwtSecret,
      { expiresIn: '24h' }
    )

    return res.json({
      token,
      agent: agentsService.toPublicAgent(agent),
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'خطأ في تسجيل الدخول' })
  }
})

export default router
