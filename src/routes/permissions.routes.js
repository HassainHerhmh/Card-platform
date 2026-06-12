import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as permissionsService from '../services/permissions.service.js'

const router = Router()
router.use(requireAuth)

router.get('/:userId', async (req, res) => {
  try {
    const permissions = await permissionsService.getUserPermissions(+req.params.userId)
    res.json({ permissions })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب الصلاحيات' })
  }
})

router.put('/:userId', async (req, res) => {
  try {
    await permissionsService.saveUserPermissions(+req.params.userId, req.body.permissions)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حفظ الصلاحيات' })
  }
})

export default router
