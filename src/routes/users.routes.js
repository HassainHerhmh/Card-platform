import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as usersService from '../services/users.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (_req, res) => {
  try {
    const users = await usersService.getAllUsers()
    res.json({ users })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب المستخدمين' })
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, username, email, role, password } = req.body
    const user = await usersService.createUser({ name, username, email, role, password })
    res.status(201).json({ user })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message?.includes('duplicate') ? 'اسم المستخدم مستخدم مسبقاً' : 'تعذر إضافة المستخدم' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const user = await usersService.updateUser(+req.params.id, req.body)
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' })
    res.json({ user })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: 'تعذر تحديث المستخدم' })
  }
})

router.put('/:id/password', async (req, res) => {
  try {
    await usersService.updatePassword(+req.params.id, req.body.password)
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: 'تعذر تحديث كلمة المرور' })
  }
})

router.put('/:id/toggle-status', async (req, res) => {
  try {
    const user = await usersService.toggleUserStatus(+req.params.id)
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' })
    res.json({ user })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر تغيير الحالة' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await usersService.deleteUser(+req.params.id)
    res.json({ ok: true })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر حذف المستخدم' })
  }
})

export default router
