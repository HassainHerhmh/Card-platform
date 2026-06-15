import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as accounting from '../services/accounting.service.js'
import { syncMissingBatchJournals } from '../services/ledger.service.js'

const router = Router()
router.use(requireAuth)

function ok(res, payload = {}) {
  res.json({ success: true, ...payload })
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, message: error.message || String(error) })
}

router.get('/accounts', async (_req, res) => {
  try {
    const data = await accounting.listAccounts()
    res.json(data)
  } catch (e) { fail(res, e, 500) }
})

router.get('/accounts/sub-for-ceiling', async (_req, res) => {
  try {
    ok(res, { list: await accounting.listSubAccounts() })
  } catch (e) { fail(res, e, 500) }
})

router.get('/accounts/main-for-cashboxes', async (_req, res) => {
  try {
    ok(res, { accounts: await accounting.listMainAccountsForEntity('cash_box') })
  } catch (e) { fail(res, e, 500) }
})

router.get('/accounts/main-for-banks', async (_req, res) => {
  try {
    ok(res, { accounts: await accounting.listMainAccountsForEntity('bank') })
  } catch (e) { fail(res, e, 500) }
})

router.post('/accounts', async (req, res) => {
  try {
    const row = await accounting.createAccount({
      ...req.body,
      created_by: req.user?.id || null,
    })
    ok(res, row)
  } catch (e) { fail(res, e) }
})

router.put('/accounts/:id', async (req, res) => {
  try {
    await accounting.updateAccount(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/accounts/:id', async (req, res) => {
  try {
    await accounting.deleteAccount(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/account-groups', async (req, res) => {
  try {
    ok(res, { groups: await accounting.listAccountGroups(req.query.search || '') })
  } catch (e) { fail(res, e, 500) }
})

router.post('/account-groups', async (req, res) => {
  try {
    ok(res, await accounting.createAccountGroup(req.body))
  } catch (e) { fail(res, e) }
})

router.put('/account-groups/:id', async (req, res) => {
  try {
    await accounting.updateAccountGroup(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/account-groups/:id', async (req, res) => {
  try {
    await accounting.deleteAccountGroup(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/currencies', async (_req, res) => {
  try {
    ok(res, { currencies: await accounting.listCurrencies() })
  } catch (e) { fail(res, e, 500) }
})

router.post('/currencies', async (req, res) => {
  try {
    ok(res, await accounting.createCurrency(req.body))
  } catch (e) { fail(res, e) }
})

router.put('/currencies/:id', async (req, res) => {
  try {
    await accounting.updateCurrency(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/currencies/:id', async (req, res) => {
  try {
    await accounting.deleteCurrency(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

const simpleTypeRoutes = [
  ['journal-types', 'journal_types'],
  ['receipt-types', 'receipt_types'],
  ['payment-types', 'payment_types'],
]

for (const [path, table] of simpleTypeRoutes) {
  router.get(`/${path}`, async (req, res) => {
    try {
      ok(res, { list: await accounting.listSimpleTypes(table, req.query.search || '') })
    } catch (e) { fail(res, e, 500) }
  })
  router.post(`/${path}`, async (req, res) => {
    try {
      ok(res, await accounting.createSimpleType(table, req.body))
    } catch (e) { fail(res, e) }
  })
  router.put(`/${path}/:id`, async (req, res) => {
    try {
      await accounting.updateSimpleType(table, +req.params.id, req.body)
      ok(res)
    } catch (e) { fail(res, e) }
  })
  router.delete(`/${path}/:id`, async (req, res) => {
    try {
      await accounting.deleteSimpleType(table, +req.params.id)
      ok(res)
    } catch (e) { fail(res, e) }
  })
}

router.get('/cashbox-groups', async (req, res) => {
  try {
    ok(res, { groups: await accounting.listCashboxGroups(req.query.search || '') })
  } catch (e) { fail(res, e, 500) }
})

router.post('/cashbox-groups', async (req, res) => {
  try {
    ok(res, await accounting.createCashboxGroup(req.body))
  } catch (e) { fail(res, e) }
})

router.put('/cashbox-groups/:id', async (req, res) => {
  try {
    await accounting.updateCashboxGroup(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/cashbox-groups/:id', async (req, res) => {
  try {
    await accounting.deleteCashboxGroup(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/cash-boxes', async (req, res) => {
  try {
    ok(res, { list: await accounting.listCashBoxes(req.query.search || '') })
  } catch (e) { fail(res, e, 500) }
})

router.post('/cash-boxes', async (req, res) => {
  try {
    ok(res, await accounting.createCashBox({
      ...req.body,
      created_by: req.user?.id || req.body.created_by || null,
    }))
  } catch (e) { fail(res, e) }
})

router.put('/cash-boxes/:id', async (req, res) => {
  try {
    await accounting.updateCashBox(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/cash-boxes/:id', async (req, res) => {
  try {
    await accounting.deleteCashBox(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/bank-groups', async (req, res) => {
  try {
    ok(res, { groups: await accounting.listBankGroups(req.query.search || '') })
  } catch (e) { fail(res, e, 500) }
})

router.post('/bank-groups', async (req, res) => {
  try {
    ok(res, await accounting.createBankGroup(req.body))
  } catch (e) { fail(res, e) }
})

router.put('/bank-groups/:id', async (req, res) => {
  try {
    await accounting.updateBankGroup(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/bank-groups/:id', async (req, res) => {
  try {
    await accounting.deleteBankGroup(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/banks', async (req, res) => {
  try {
    ok(res, { banks: await accounting.listBanks(req.query.search || '') })
  } catch (e) { fail(res, e, 500) }
})

router.post('/banks', async (req, res) => {
  try {
    ok(res, await accounting.createBank({
      ...req.body,
      created_by: req.user?.id || req.body.created_by || null,
    }))
  } catch (e) { fail(res, e) }
})

router.delete('/banks/:id', async (req, res) => {
  try {
    await accounting.deleteBank(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/receipt-vouchers', async (_req, res) => {
  try {
    ok(res, { list: await accounting.listReceiptVouchers() })
  } catch (e) { fail(res, e, 500) }
})

router.post('/receipt-vouchers', async (req, res) => {
  try {
    ok(res, await accounting.createReceiptVoucher(req.body))
  } catch (e) { fail(res, e) }
})

router.delete('/receipt-vouchers/:id', async (req, res) => {
  try {
    await accounting.deleteReceiptVoucher(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/payment-vouchers', async (_req, res) => {
  try {
    ok(res, { list: await accounting.listPaymentVouchers() })
  } catch (e) { fail(res, e, 500) }
})

router.post('/payment-vouchers', async (req, res) => {
  try {
    ok(res, await accounting.createPaymentVoucher(req.body))
  } catch (e) { fail(res, e) }
})

router.delete('/payment-vouchers/:id', async (req, res) => {
  try {
    await accounting.deletePaymentVoucher(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/journal-entries', async (_req, res) => {
  try {
    try {
      await syncMissingBatchJournals({ limit: 100 })
    } catch (syncError) {
      console.warn('[accounting] batch journal sync skipped:', syncError.message)
    }
    ok(res, { list: await accounting.listJournalEntriesGrouped() })
  } catch (e) { fail(res, e, 500) }
})

router.post('/journal-entries', async (req, res) => {
  try {
    await accounting.createJournalEntryLine(req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.put('/journal-entries/:id', async (req, res) => {
  try {
    await accounting.updateJournalEntry(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/journal-entries/:id', async (req, res) => {
  try {
    await accounting.deleteJournalEntry(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/journal-entries/by-ref/:ref', async (req, res) => {
  try {
    await accounting.deleteJournalEntriesByRef(req.params.ref)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/account-ceilings', async (_req, res) => {
  try {
    ok(res, { list: await accounting.listAccountCeilings() })
  } catch (e) { fail(res, e, 500) }
})

router.post('/account-ceilings', async (req, res) => {
  try {
    ok(res, await accounting.createAccountCeiling(req.body))
  } catch (e) { fail(res, e) }
})

router.put('/account-ceilings/:id', async (req, res) => {
  try {
    await accounting.updateAccountCeiling(+req.params.id, req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.delete('/account-ceilings/:id', async (req, res) => {
  try {
    await accounting.deleteAccountCeiling(+req.params.id)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/settings/transit-accounts', async (_req, res) => {
  try {
    ok(res, { data: await accounting.getTransitAccounts() })
  } catch (e) { fail(res, e, 500) }
})

router.post('/settings/transit-accounts', async (req, res) => {
  try {
    await accounting.saveTransitAccounts(req.body)
    ok(res)
  } catch (e) { fail(res, e) }
})

router.get('/currency-exchange/form-data', async (req, res) => {
  try {
    const [currencies, accounts] = await Promise.all([
      accounting.listCurrencies(),
      accounting.listSubAccounts(),
    ])
    ok(res, { currencies, accounts, type: req.query.type || 'cash' })
  } catch (e) { fail(res, e, 500) }
})

router.post('/currency-exchange', async (req, res) => {
  try {
    ok(res, await accounting.executeCurrencyExchange(req.body))
  } catch (e) { fail(res, e) }
})

router.post('/reports/account-statement', async (req, res) => {
  try {
    try {
      await syncMissingBatchJournals({ limit: 100 })
    } catch (syncError) {
      console.warn('[accounting] batch journal sync skipped:', syncError.message)
    }
    const list = await accounting.getAccountStatement(req.body)
    ok(res, { list })
  } catch (e) { fail(res, e, 500) }
})

export default router
