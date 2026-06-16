import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as printTemplatesService from '../services/print-templates.service.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (_req, res) => {
  try {
    const templates = await printTemplatesService.listPrintTemplates()
    res.json({ templates })
  } catch (error) {
    res.status(500).json({ message: error.message || 'تعذر جلب قوالب الطباعة' })
  }
})

router.get('/default', async (_req, res) => {
  try {
    const template = await printTemplatesService.getDefaultPrintTemplate()
    res.json({ template })
  } catch (error) {
    res.status(500).json({ message: error.message || 'تعذر جلب القالب الافتراضي' })
  }
})

router.get('/for-category/:categoryId', async (req, res) => {
  try {
    const template = await printTemplatesService.getPrintTemplateForCategory(+req.params.categoryId)
    res.json({ template })
  } catch (error) {
    res.status(500).json({ message: error.message || 'تعذر جلب قالب الباقة' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const template = await printTemplatesService.getPrintTemplate(+req.params.id)
    res.json({ template })
  } catch (error) {
    res.status(error.message === 'القالب غير موجود' ? 404 : 500).json({
      message: error.message || 'تعذر جلب القالب',
    })
  }
})

router.post('/', async (req, res) => {
  try {
    const { name, config, categoryId, isDefault } = req.body
    const template = await printTemplatesService.createPrintTemplate({
      name,
      config,
      categoryId,
      isDefault,
    })
    res.status(201).json({ template })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر إنشاء القالب' })
  }
})

router.put('/:id', async (req, res) => {
  try {
    const { name, config, categoryId, isDefault } = req.body
    const template = await printTemplatesService.updatePrintTemplate(+req.params.id, {
      name,
      config,
      categoryId,
      isDefault,
    })
    res.json({ template })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر تحديث القالب' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await printTemplatesService.deletePrintTemplate(+req.params.id)
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ message: error.message || 'تعذر حذف القالب' })
  }
})

export default router
