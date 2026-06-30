import { Router } from 'express'
import { requireAgentAuth } from '../middleware/agentAuth.js'
import * as agentAppService from '../services/agent-app.service.js'
import * as agentNotebookService from '../services/agent-notebook.service.js'
import * as smsGatewayService from '../services/sms-gateway.service.js'

const router = Router()
router.use(requireAgentAuth)

router.get('/me', async (req, res) => {
  try {
    const agent = await agentAppService.getAgentProfile(req.agent.id)
    if (!agent) return res.status(404).json({ message: 'الوكيل غير موجود' })
    res.json({ agent })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب بيانات الوكيل' })
  }
})

router.get('/networks', async (req, res) => {
  try {
    const networks = await agentAppService.getNetworks(req.agent.id)
    res.json({ networks })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب الشبكات' })
  }
})

router.get('/networks/:id', async (req, res) => {
  try {
    const network = await agentAppService.getNetworkById(+req.params.id, req.agent.id)
    if (!network) return res.status(404).json({ message: 'الشبكة غير موجودة' })
    res.json({ network })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب الشبكة' })
  }
})

router.get('/networks/:id/categories', async (req, res) => {
  try {
    const network = await agentAppService.getNetworkById(+req.params.id, req.agent.id)
    if (!network) return res.status(404).json({ message: 'الشبكة غير موجودة' })
    const categories = await agentAppService.getCategoriesForAgent(req.agent.id)
    res.json({ network, categories })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب فئات الكروت' })
  }
})

router.get('/transactions', async (req, res) => {
  try {
    const transactions = await agentAppService.getAgentTransactions(req.agent.id, req.query.limit)
    res.json({ transactions })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب العمليات' })
  }
})

router.get('/statement', async (req, res) => {
  try {
    const statement = await agentAppService.getAgentStatement(req.agent.id, {
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      type: req.query.type,
      queryText: req.query.query,
      limit: req.query.limit,
    })
    res.json({ statement })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب كشف الحساب' })
  }
})

router.get('/sms-service', async (_req, res) => {
  try {
    const status = await smsGatewayService.getSmsServiceStatus()
    res.json({ smsService: { available: status.available } })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر التحقق من خدمة SMS' })
  }
})

router.post('/charge', async (req, res) => {
  try {
    const { categoryId, networkId, recipientPhone, sendSms } = req.body
    if (!categoryId || !recipientPhone) {
      return res.status(400).json({ message: 'الفئة ورقم المستلم مطلوبان' })
    }
    const result = await smsGatewayService.processAgentCharge({
      agentId: req.agent.id,
      categoryId: +categoryId,
      networkId: networkId ? +networkId : null,
      recipientPhone,
      sendSms: Boolean(sendSms),
    })
    res.json({ charge: result })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'تعذر تنفيذ الشحن' })
  }
})

router.get('/notebook', async (req, res) => {
  try {
    const notebook = await agentNotebookService.getAgentNotebook(req.agent.id)
    res.json({
      payload: notebook.payload,
      updatedAt: notebook.updatedAt,
      exists: notebook.exists,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: 'تعذر جلب دفتر الحسابات' })
  }
})

router.put('/notebook', async (req, res) => {
  try {
    const saved = await agentNotebookService.saveAgentNotebook(req.agent.id, req.body?.payload)
    res.json({
      payload: saved.payload,
      updatedAt: saved.updatedAt,
    })
  } catch (error) {
    console.error(error)
    res.status(400).json({ message: error.message || 'تعذر حفظ دفتر الحسابات' })
  }
})

router.post('/notebook/sync', async (req, res) => {
  try {
    const result = await agentNotebookService.syncAgentNotebook(req.agent.id, {
      localPayload: req.body?.payload,
      localUpdatedAt: req.body?.localUpdatedAt,
    })
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: error.message || 'تعذر مزامنة دفتر الحسابات' })
  }
})

router.post('/notebook/restore', async (req, res) => {
  try {
    const result = await agentNotebookService.restoreAgentNotebook(req.agent.id)
    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: error.message || 'تعذر استعادة دفتر الحسابات' })
  }
})

export default router
