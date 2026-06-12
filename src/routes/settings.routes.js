import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as settingsService from '../services/settings.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (_req, res) => {
  try {
    const settings = await settingsService.getCardSettings()
    res.json({ settings })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب الإعدادات' })
  }
})

router.put('/', async (req, res) => {
  try {
    const settings = await settingsService.updateCardSettings(req.body)
    res.json({ settings })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حفظ الإعدادات' })
  }
})

router.get('/categories', async (_req, res) => {
  try {
    const categories = await settingsService.getCategories()
    res.json({ categories })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب الفئات' })
  }
})

router.post('/categories', async (req, res) => {
  try {
    const category = await settingsService.createCategory(req.body)
    res.status(201).json({ category })
  } catch (error) {
    res.status(500).json({ message: 'تعذر إضافة الفئة' })
  }
})

router.put('/categories/:id', async (req, res) => {
  try {
    const category = await settingsService.updateCategory(+req.params.id, req.body)
    if (!category) return res.status(404).json({ message: 'الفئة غير موجودة' })
    res.json({ category })
  } catch (error) {
    res.status(500).json({ message: 'تعذر تحديث الفئة' })
  }
})

router.delete('/categories/:id', async (req, res) => {
  try {
    await settingsService.deleteCategory(+req.params.id)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حذف الفئة' })
  }
})

export default router
