import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import {
  clearAgentLoginFailures,
  getAgentLoginLock,
  recordAgentLoginFailure,
} from '../middleware/agentLoginLimit.js'
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

    const lock = getAgentLoginLock(req, phone.trim())
    if (lock) {
      const retryAfter = Math.ceil((lock.until - Date.now()) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({ message: lock.message })
    }

    const agent = await agentsService.findByPhone(phone.trim())
    if (!agent || agent.status !== 'نشط') {
      const blocked = recordAgentLoginFailure(req, phone.trim())
      if (blocked) {
        res.setHeader('Retry-After', String(Math.ceil((blocked.until - Date.now()) / 1000)))
        return res.status(429).json({ message: blocked.message })
      }
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    const valid = await agentsService.verifyPassword(agent, password)
    if (!valid) {
      const blocked = recordAgentLoginFailure(req, phone.trim())
      if (blocked) {
        res.setHeader('Retry-After', String(Math.ceil((blocked.until - Date.now()) / 1000)))
        return res.status(429).json({ message: blocked.message })
      }
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    const deviceAllowed = await agentsService.isDeviceAllowed(agent.id, deviceId.trim())
    if (!deviceAllowed) {
      return res.status(403).json({
        message: 'هذا الجهاز غير مصرح راجع الادارة',
      })
    }

    clearAgentLoginFailures(req, phone.trim())

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
