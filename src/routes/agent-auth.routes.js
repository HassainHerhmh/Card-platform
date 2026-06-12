import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import * as agentsService from '../services/agents.service.js'

const router = Router()

router.post('/login', async (req, res) => {
  try {
    const { phone, password, deviceId } = req.body
    if (!phone?.trim() || !password) {
      return res.status(400).json({ message: 'رقم الجوال وكلمة المرور مطلوبان' })
    }
    if (!deviceId?.trim()) {
      return res.status(400).json({ message: 'معرف الجهاز مطلوب' })
    }

    const agent = await agentsService.findByPhone(phone.trim())
    if (!agent || agent.status !== 'نشط') {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة أو الحساب موقوف' })
    }

    const valid = await agentsService.verifyPassword(agent, password)
    if (!valid) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    const deviceAllowed = await agentsService.isDeviceAllowed(agent.id, deviceId.trim())
    if (!deviceAllowed) {
      return res.status(403).json({
        message: 'هذا الجهاز غير مسجّل — أضف معرف الجهاز من لوحة التحكم أولاً',
      })
    }

    const token = jwt.sign(
      { id: agent.id, phone: agent.phone, type: 'agent', deviceId: deviceId.trim() },
      env.jwtSecret,
      { expiresIn: '24h' }
    )

    const devices = await agentsService.getAgentDevices(agent.id)

    return res.json({
      token,
      agent: agentsService.toPublicAgent(agent, devices),
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'خطأ في تسجيل الدخول' })
  }
})

export default router
