import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as rechargeService from '../services/recharge.service.js'

const router = Router()
router.use(requireAuth)

router.get('/providers', async (_req, res) => {
  try {
    const providers = await rechargeService.getProviders()
    res.json({ providers })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب المزودين' })
  }
})

router.get('/providers/:id', async (req, res) => {
  try {
    const provider = await rechargeService.getProviderById(Number(req.params.id))
    if (!provider) {
      res.status(404).json({ message: 'المزود غير موجود' })
      return
    }
    res.json({ provider })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب المزود' })
  }
})

router.post('/providers', async (req, res) => {
  try {
    const provider = await rechargeService.createProvider(req.body)
    res.status(201).json({ provider })
  } catch (error) {
    res.status(500).json({ message: 'تعذر إضافة المزود' })
  }
})

router.put('/providers/:id', async (req, res) => {
  try {
    const provider = await rechargeService.updateProvider(Number(req.params.id), req.body)
    if (!provider) {
      res.status(404).json({ message: 'المزود غير موجود' })
      return
    }
    res.json({ provider })
  } catch (error) {
    res.status(500).json({ message: 'تعذر تحديث المزود' })
  }
})

router.delete('/providers/:id', async (req, res) => {
  try {
    await rechargeService.deleteProvider(Number(req.params.id))
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حذف المزود' })
  }
})

router.get('/provider', async (_req, res) => {
  try {
    const provider = await rechargeService.getProviderConfig()
    res.json({ provider })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب إعدادات المزود' })
  }
})

router.put('/provider', async (req, res) => {
  try {
    const provider = await rechargeService.updateProviderConfig(req.body)
    res.json({ provider })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حفظ إعدادات المزود' })
  }
})

router.get('/carriers', async (_req, res) => {
  try {
    const carriers = await rechargeService.getCarriers()
    res.json({ carriers })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب شركات الاتصالات' })
  }
})

router.post('/carriers', async (req, res) => {
  try {
    const carrier = await rechargeService.createCarrier(req.body)
    res.status(201).json({ carrier })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: 'شركة الاتصالات موجودة مسبقاً' })
      return
    }
    res.status(500).json({ message: 'تعذر إضافة شركة الاتصالات' })
  }
})

router.put('/carriers/:id', async (req, res) => {
  try {
    const carrier = await rechargeService.updateCarrier(Number(req.params.id), req.body)
    if (!carrier) {
      res.status(404).json({ message: 'شركة الاتصالات غير موجودة' })
      return
    }
    res.json({ carrier })
  } catch (error) {
    res.status(500).json({ message: 'تعذر تحديث شركة الاتصالات' })
  }
})

router.delete('/carriers/:id', async (req, res) => {
  try {
    await rechargeService.deleteCarrier(Number(req.params.id))
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حذف شركة الاتصالات' })
  }
})

router.get('/services', async (req, res) => {
  try {
    const carrierId = req.query.carrierId ? Number(req.query.carrierId) : null
    const services = await rechargeService.getServices(carrierId)
    res.json({ services })
  } catch (error) {
    res.status(500).json({ message: 'تعذر جلب الخدمات' })
  }
})

router.post('/services', async (req, res) => {
  try {
    const service = await rechargeService.createService(req.body)
    res.status(201).json({ service })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: 'رقم الخدمة موجود مسبقاً لهذه الشركة' })
      return
    }
    res.status(500).json({ message: 'تعذر إضافة الخدمة' })
  }
})

router.put('/services/:id', async (req, res) => {
  try {
    const service = await rechargeService.updateService(Number(req.params.id), req.body)
    if (!service) {
      res.status(404).json({ message: 'الخدمة غير موجودة' })
      return
    }
    res.json({ service })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ message: 'رقم الخدمة موجود مسبقاً لهذه الشركة' })
      return
    }
    res.status(500).json({ message: 'تعذر تحديث الخدمة' })
  }
})

router.delete('/services/:id', async (req, res) => {
  try {
    await rechargeService.deleteService(Number(req.params.id))
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ message: 'تعذر حذف الخدمة' })
  }
})

export default router
