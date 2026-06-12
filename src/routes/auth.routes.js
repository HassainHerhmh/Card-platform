import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import * as usersService from '../services/users.service.js'

const router = Router()

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    const user = await usersService.findByUsername(username)
    if (!user || user.status !== 'نشط') {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    const valid = await usersService.verifyPassword(user, password)
    if (!valid) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' })
    }

    await usersService.updateLastLogin(user.id)

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      env.jwtSecret,
      { expiresIn: '8h' }
    )

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
    })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ message: 'خطأ في تسجيل الدخول' })
  }
})

export default router
