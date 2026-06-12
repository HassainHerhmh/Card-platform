import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

const router = Router()

router.post('/login', (req, res) => {
  const { username, password } = req.body

  if (username === 'admin' && password === '123456') {
    const token = jwt.sign({ id: 1, username: 'admin', role: 'مدير' }, env.jwtSecret, {
      expiresIn: '8h',
    })

    return res.json({
      token,
      user: { id: 1, name: 'مدير النظام', username: 'admin', role: 'مدير' },
    })
  }

  return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
})

export default router
