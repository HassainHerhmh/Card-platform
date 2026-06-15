import { query } from '../db/pool.js'
import { formatDateTime } from '../utils/format.js'

export async function ensureAccountingTables() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS account_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS accounting_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      parent_id INT NULL,
      account_group_id INT NULL,
      account_level VARCHAR(20) NOT NULL DEFAULT 'رئيسي',
      financial_statement VARCHAR(100) NULL,
      entity_type VARCHAR(30) NULL,
      entity_id INT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_parent (parent_id),
      INDEX idx_level (account_level)
    )`,
    `CREATE TABLE IF NOT EXISTS currencies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_ar VARCHAR(255) NOT NULL,
      code VARCHAR(20) NOT NULL,
      symbol VARCHAR(20) DEFAULT '',
      exchange_rate DECIMAL(18,6) NOT NULL DEFAULT 1,
      min_rate DECIMAL(18,6) NULL,
      max_rate DECIMAL(18,6) NULL,
      is_local TINYINT NOT NULL DEFAULT 0,
      convert_mode VARCHAR(5) NOT NULL DEFAULT '*'
    )`,
    `CREATE TABLE IF NOT EXISTS journal_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      sort_order INT NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS receipt_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      sort_order INT NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS payment_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      sort_order INT NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS cashbox_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code INT NOT NULL,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL
    )`,
    `CREATE TABLE IF NOT EXISTS cash_boxes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      code VARCHAR(50) NOT NULL,
      cash_box_group_id INT NOT NULL,
      account_id INT NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS bank_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) NOT NULL,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL
    )`,
    `CREATE TABLE IF NOT EXISTS banks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name_ar VARCHAR(255) NOT NULL,
      name_en VARCHAR(255) NULL,
      code VARCHAR(50) NOT NULL,
      bank_group_id INT NOT NULL,
      account_id INT NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS receipt_vouchers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      voucher_no VARCHAR(50) NOT NULL,
      voucher_date DATE NOT NULL,
      receipt_type VARCHAR(20) NOT NULL,
      cash_box_account_id INT NULL,
      bank_account_id INT NULL,
      transfer_no VARCHAR(100) NULL,
      currency_id INT NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      account_id INT NOT NULL,
      analytic_account_id INT NULL,
      cost_center_id INT NULL,
      journal_type_id INT NULL,
      notes TEXT NULL,
      handling DECIMAL(18,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS payment_vouchers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      voucher_no VARCHAR(50) NOT NULL,
      voucher_date DATE NOT NULL,
      payment_type VARCHAR(20) NOT NULL,
      cash_box_account_id INT NULL,
      bank_account_id INT NULL,
      transfer_no VARCHAR(100) NULL,
      currency_id INT NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      account_id INT NOT NULL,
      analytic_account_id INT NULL,
      cost_center_id INT NULL,
      journal_type_id INT NULL,
      notes TEXT NULL,
      handling DECIMAL(18,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS journal_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      journal_type_id INT NULL,
      reference_type VARCHAR(50) NOT NULL DEFAULT 'manual',
      reference_id BIGINT NOT NULL,
      journal_date DATE NOT NULL,
      currency_id INT NOT NULL,
      account_id INT NOT NULL,
      debit DECIMAL(18,2) NOT NULL DEFAULT 0,
      credit DECIMAL(18,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      cost_center_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ref (reference_type, reference_id),
      INDEX idx_account (account_id),
      INDEX idx_date (journal_date)
    )`,
    `CREATE TABLE IF NOT EXISTS currency_exchanges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exchange_date DATE NOT NULL,
      exchange_type VARCHAR(20) NOT NULL,
      from_currency_id INT NOT NULL,
      to_currency_id INT NOT NULL,
      from_account_id INT NOT NULL,
      to_account_id INT NOT NULL,
      from_amount DECIMAL(18,2) NOT NULL,
      to_amount DECIMAL(18,2) NOT NULL,
      rate DECIMAL(18,6) NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS account_ceilings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      scope VARCHAR(20) NOT NULL,
      account_id INT NULL,
      account_group_id INT NULL,
      currency_id INT NOT NULL,
      ceiling_amount DECIMAL(18,2) NOT NULL,
      account_nature VARCHAR(20) NOT NULL DEFAULT 'debit',
      exceed_action VARCHAR(20) NOT NULL DEFAULT 'block'
    )`,
    `CREATE TABLE IF NOT EXISTS transit_account_settings (
      id TINYINT PRIMARY KEY DEFAULT 1,
      commission_income_account INT NULL,
      card_income_account INT NULL,
      courier_commission_account INT NULL,
      transfer_guarantee_account INT NULL,
      currency_exchange_account INT NULL,
      customer_guarantee_account INT NULL,
      customer_credit_account INT NULL,
      coupon_discount_account INT NULL
    )`,
  ]

  for (const sql of statements) {
    await query(sql)
  }

  try {
    await query('ALTER TABLE accounting_accounts ADD COLUMN created_by INT NULL')
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error
  }

  try {
    await query('ALTER TABLE agents ADD COLUMN account_id INT NULL')
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error
  }

  try {
    await query('ALTER TABLE transit_account_settings ADD COLUMN card_income_account INT NULL')
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error
  }

  const { rows: currencyRows } = await query('SELECT id FROM currencies LIMIT 1')
  if (!currencyRows.length) {
    await query(
      `INSERT INTO currencies (name_ar, code, symbol, exchange_rate, is_local, convert_mode)
       VALUES ('ريال يمني', 'YER', 'ر.ي', 1, 1, '*')`
    )
  }

  const { rows: jtRows } = await query('SELECT id FROM journal_types LIMIT 1')
  if (!jtRows.length) {
    await query(`INSERT INTO journal_types (name_ar, sort_order) VALUES ('قيد يومي', 1)`)
  }

  await backfillFinancialStatements()
  await backfillEntityAccountCreators()
}

function normalizeArabicName(value) {
  return String(value || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function inferFinancialStatement(nameAr, parentFinancial = null) {
  if (parentFinancial) return parentFinancial

  const name = normalizeArabicName(nameAr)
  if (!name) return null

  if (/اصول|خصوم|ملكيه|مطلوبات|التزامات|نقديه|بنوك|صناديق/.test(name)) {
    return 'الميزانية العمومية'
  }

  if (/ايراد|مصروف|مبيعات|تكلفه|ربح|خسار/.test(name)) {
    return 'أرباح وخسائر'
  }

  return null
}

async function getParentFinancialStatement(parentId) {
  if (!parentId) return null
  const { rows } = await query(
    'SELECT financial_statement FROM accounting_accounts WHERE id = $1',
    [parentId]
  )
  return rows[0]?.financial_statement || null
}

async function resolveFinancialStatement(data) {
  if (data.financial_statement) return data.financial_statement

  const fromParent = await getParentFinancialStatement(data.parent_id)
  if (fromParent) return fromParent

  return inferFinancialStatement(data.name_ar)
}

async function backfillFinancialStatements() {
  try {
    const { rows } = await query(
      `SELECT id, name_ar, parent_id, financial_statement FROM accounting_accounts
       WHERE financial_statement IS NULL OR financial_statement = ''`
    )

    for (const row of rows) {
      const fromParent = await getParentFinancialStatement(row.parent_id)
      const financial = fromParent || inferFinancialStatement(row.name_ar)
      if (!financial) continue
      await query('UPDATE accounting_accounts SET financial_statement = $1 WHERE id = $2', [
        financial,
        row.id,
      ])
    }
  } catch (error) {
    console.warn('account financial_statement backfill skipped:', error.message)
  }
}

async function backfillEntityAccountCreators() {
  try {
    await query(
      `UPDATE accounting_accounts aa
       INNER JOIN cash_boxes cb ON cb.account_id = aa.id
       SET aa.created_by = cb.created_by
       WHERE aa.created_by IS NULL AND cb.created_by IS NOT NULL`
    )
    await query(
      `UPDATE accounting_accounts aa
       INNER JOIN banks b ON b.account_id = aa.id
       SET aa.created_by = b.created_by
       WHERE aa.created_by IS NULL AND b.created_by IS NOT NULL`
    )
  } catch (error) {
    console.warn('entity account created_by backfill skipped:', error.message)
  }
}

function mapAccount(row) {
  return {
    id: row.id,
    code: row.code,
    name_ar: row.name_ar,
    name_en: row.name_en,
    parent_id: row.parent_id,
    account_group_id: row.account_group_id,
    account_level: row.account_level,
    financial_statement: row.financial_statement,
    parent_name: row.parent_name || null,
    group_name: row.group_name || null,
    created_by: row.created_by_name || row.created_by_username || null,
    branch_name: row.branch_name || null,
    created_at: row.created_at ? formatDateTime(row.created_at) : null,
  }
}

const ACCOUNT_LIST_SQL = `
  SELECT aa.id, aa.code, aa.name_ar, aa.name_en, aa.parent_id, aa.account_group_id,
         aa.account_level, aa.financial_statement, aa.created_at,
         p.name_ar AS parent_name,
         ag.name_ar AS group_name,
         u.username AS created_by_username,
         TRIM(CONCAT_WS(' ', NULLIF(TRIM(u.name), ''), NULLIF(TRIM(u.role), ''))) AS created_by_name
  FROM accounting_accounts aa
  LEFT JOIN accounting_accounts p ON p.id = aa.parent_id
  LEFT JOIN account_groups ag ON ag.id = aa.account_group_id
  LEFT JOIN platform_users u ON u.id = aa.created_by
`

function buildTree(list) {
  const byParent = new Map()
  for (const item of list) {
    const key = item.parent_id || 0
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push({ ...item, children: [] })
  }
  function attach(parentId) {
    const nodes = byParent.get(parentId || 0) || []
    for (const node of nodes) {
      node.children = attach(node.id)
    }
    return nodes
  }
  return attach(0)
}

async function nextAccountCode(parentId) {
  if (!parentId) {
    const { rows } = await query(
      `SELECT code FROM accounting_accounts WHERE parent_id IS NULL ORDER BY id DESC LIMIT 1`
    )
    const last = rows[0]?.code ? Number(rows[0].code) : 0
    return String(last + 1)
  }
  const { rows: parentRows } = await query(
    'SELECT code FROM accounting_accounts WHERE id = $1',
    [parentId]
  )
  const parentCode = parentRows[0]?.code || '0'
  const { rows } = await query(
    'SELECT code FROM accounting_accounts WHERE parent_id = $1 ORDER BY id DESC LIMIT 1',
    [parentId]
  )
  const suffix = rows.length ? Number(String(rows[0].code).slice(parentCode.length)) + 1 : 1
  return `${parentCode}${suffix}`
}

export async function listAccounts() {
  const { rows } = await query(`${ACCOUNT_LIST_SQL} ORDER BY aa.code`)
  const list = rows.map(mapAccount)
  return { tree: buildTree(list), list }
}

export async function listSubAccounts() {
  const { rows } = await query(
    `${ACCOUNT_LIST_SQL} WHERE aa.account_level = 'فرعي' ORDER BY aa.code`
  )
  return rows.map(mapAccount)
}

export async function validateSubAccount(accountId) {
  if (!accountId) return null
  const { rows } = await query(
    `SELECT id, code, name_ar FROM accounting_accounts WHERE id = $1 AND account_level = 'فرعي'`,
    [accountId]
  )
  if (!rows[0]) throw new Error('يجب اختيار حساب فرعي صالح من دليل الحسابات')
  return rows[0]
}

export async function getAccountsBalances(accountIds = []) {
  const ids = [...new Set(accountIds.filter(Boolean))]
  if (!ids.length) return {}

  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ')
  const { rows } = await query(
    `SELECT account_id, COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance
     FROM journal_entries
     WHERE account_id IN (${placeholders})
     GROUP BY account_id`,
    ids
  )

  const balances = {}
  for (const row of rows) {
    balances[row.account_id] = Number(row.balance)
  }
  return balances
}

export async function getAccountBalance(accountId) {
  if (!accountId) return null
  const balances = await getAccountsBalances([accountId])
  return balances[accountId] ?? 0
}

export async function listMainAccountsForEntity(_entityType) {
  const { rows } = await query(
    `SELECT id, code, name_ar, parent_id
     FROM accounting_accounts
     WHERE account_level = 'رئيسي'
     ORDER BY code`
  )
  return rows
}

export async function createAccount(data) {
  const parentId = data.parent_id || null
  const level = data.account_level || (parentId ? 'فرعي' : 'رئيسي')
  const code = await nextAccountCode(parentId)
  const financialStatement = await resolveFinancialStatement({ ...data, parent_id: parentId })
  const { insertId } = await query(
    `INSERT INTO accounting_accounts
     (code, name_ar, name_en, parent_id, account_group_id, account_level, financial_statement, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      code,
      data.name_ar,
      data.name_en || null,
      parentId,
      data.account_group_id || null,
      level,
      financialStatement,
      data.created_by || null,
    ]
  )
  return { id: insertId, code, financial_statement: financialStatement }
}

export async function updateAccount(id, data) {
  const financialStatement = data.financial_statement
    ?? (data.name_ar ? inferFinancialStatement(data.name_ar) : null)

  await query(
    `UPDATE accounting_accounts SET
      name_ar = COALESCE($2, name_ar),
      name_en = COALESCE($3, name_en),
      parent_id = $4,
      account_group_id = $5,
      account_level = COALESCE($6, account_level),
      financial_statement = COALESCE($7, financial_statement)
     WHERE id = $1`,
    [
      id,
      data.name_ar,
      data.name_en ?? null,
      data.parent_id ?? null,
      data.account_group_id ?? null,
      data.account_level,
      financialStatement,
    ]
  )
}

export async function deleteAccount(id) {
  const { rows: childRows } = await query(
    'SELECT id FROM accounting_accounts WHERE parent_id = $1 LIMIT 1',
    [id]
  )
  if (childRows.length) throw new Error('لا يمكن حذف حساب له حسابات فرعية')
  await query('DELETE FROM accounting_accounts WHERE id = $1', [id])
}

async function createLinkedSubAccount({
  parentId,
  name_ar,
  name_en,
  entityType,
  entityId,
  created_by = null,
}) {
  const code = await nextAccountCode(parentId)
  const parentFinancial = await getParentFinancialStatement(parentId)
  const financialStatement = parentFinancial || inferFinancialStatement(name_ar, parentFinancial)

  const { insertId } = await query(
    `INSERT INTO accounting_accounts
     (code, name_ar, name_en, parent_id, account_level, financial_statement, entity_type, entity_id, created_by)
     VALUES ($1, $2, $3, $4, 'فرعي', $5, $6, $7, $8)`,
    [
      code,
      name_ar,
      name_en || null,
      parentId,
      financialStatement,
      entityType,
      entityId,
      created_by || null,
    ]
  )
  return insertId
}

export async function listAccountGroups(search = '') {
  const like = `%${search}%`
  const { rows } = search
    ? await query(
        'SELECT * FROM account_groups WHERE name_ar LIKE $1 OR code LIKE $1 ORDER BY code',
        [like]
      )
    : await query('SELECT * FROM account_groups ORDER BY code')
  return rows
}

export async function createAccountGroup(data) {
  const { insertId } = await query(
    'INSERT INTO account_groups (code, name_ar, name_en) VALUES ($1, $2, $3)',
    [data.code, data.name_ar, data.name_en || null]
  )
  return { id: insertId }
}

export async function updateAccountGroup(id, data) {
  await query(
    'UPDATE account_groups SET name_ar = $2, name_en = $3, code = $4 WHERE id = $1',
    [id, data.name_ar, data.name_en || null, data.code]
  )
}

export async function deleteAccountGroup(id) {
  await query('DELETE FROM account_groups WHERE id = $1', [id])
}

export async function listCurrencies() {
  const { rows } = await query('SELECT * FROM currencies ORDER BY is_local DESC, id')
  return rows
}

export async function createCurrency(data) {
  const { insertId } = await query(
    `INSERT INTO currencies
     (name_ar, code, symbol, exchange_rate, min_rate, max_rate, is_local, convert_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.name_ar,
      data.code,
      data.symbol || '',
      data.exchange_rate,
      data.min_rate ?? null,
      data.max_rate ?? null,
      data.is_local ? 1 : 0,
      data.convert_mode || '*',
    ]
  )
  return { id: insertId }
}

export async function updateCurrency(id, data) {
  await query(
    `UPDATE currencies SET
      name_ar = $2, code = $3, symbol = $4, exchange_rate = $5,
      min_rate = $6, max_rate = $7, is_local = $8, convert_mode = $9
     WHERE id = $1`,
    [
      id,
      data.name_ar,
      data.code,
      data.symbol || '',
      data.exchange_rate,
      data.min_rate ?? null,
      data.max_rate ?? null,
      data.is_local ? 1 : 0,
      data.convert_mode || '*',
    ]
  )
}

export async function deleteCurrency(id) {
  await query('DELETE FROM currencies WHERE id = $1', [id])
}

export async function listSimpleTypes(table, search = '') {
  const like = `%${search}%`
  const { rows } = search
    ? await query(`SELECT * FROM ${table} WHERE name_ar LIKE $1 ORDER BY sort_order, id`, [like])
    : await query(`SELECT * FROM ${table} ORDER BY sort_order, id`)
  return rows
}

export async function createSimpleType(table, data) {
  const { insertId } = await query(
    `INSERT INTO ${table} (name_ar, name_en, sort_order) VALUES ($1, $2, $3)`,
    [data.name_ar, data.name_en || null, data.sort_order ?? 0]
  )
  return { id: insertId }
}

export async function updateSimpleType(table, id, data) {
  await query(
    `UPDATE ${table} SET name_ar = $2, name_en = $3, sort_order = $4 WHERE id = $1`,
    [id, data.name_ar, data.name_en || null, data.sort_order ?? 0]
  )
}

export async function deleteSimpleType(table, id) {
  await query(`DELETE FROM ${table} WHERE id = $1`, [id])
}

export async function listCashboxGroups(search = '') {
  const like = `%${search}%`
  const { rows } = search
    ? await query('SELECT * FROM cashbox_groups WHERE name_ar LIKE $1 ORDER BY code', [like])
    : await query('SELECT * FROM cashbox_groups ORDER BY code')
  return rows
}

export async function createCashboxGroup(data) {
  const { insertId } = await query(
    'INSERT INTO cashbox_groups (code, name_ar, name_en) VALUES ($1, $2, $3)',
    [data.code, data.name_ar, data.name_en || null]
  )
  return { id: insertId }
}

export async function updateCashboxGroup(id, data) {
  await query(
    'UPDATE cashbox_groups SET name_ar = $2, name_en = $3 WHERE id = $1',
    [id, data.name_ar, data.name_en || null]
  )
}

export async function deleteCashboxGroup(id) {
  await query('DELETE FROM cashbox_groups WHERE id = $1', [id])
}

export async function listCashBoxes(search = '') {
  const like = `%${search}%`
  const { rows } = await query(
    `SELECT cb.*, cg.name_ar AS cashbox_group_name, aa.name_ar AS account_name
     FROM cash_boxes cb
     LEFT JOIN cashbox_groups cg ON cg.id = cb.cash_box_group_id
     LEFT JOIN accounting_accounts aa ON aa.id = cb.account_id
     ${search ? 'WHERE cb.name_ar LIKE $1 OR cb.code LIKE $1' : ''}
     ORDER BY cb.id DESC`,
    search ? [like] : []
  )
  return rows.map((r) => ({ ...r, user_name: null, branch_name: null }))
}

export async function createCashBox(data) {
  const accountId = await createLinkedSubAccount({
    parentId: data.parent_account_id,
    name_ar: data.name_ar,
    name_en: data.name_en,
    entityType: 'cash_box',
    entityId: null,
    created_by: data.created_by || null,
  })
  const code = String(accountId).padStart(4, '0')
  const { insertId } = await query(
    `INSERT INTO cash_boxes (name_ar, name_en, code, cash_box_group_id, account_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.name_ar, data.name_en || null, code, data.cash_box_group_id, accountId, data.created_by || null]
  )
  await query('UPDATE accounting_accounts SET entity_id = $1 WHERE id = $2', [insertId, accountId])
  return { id: insertId, account_id: accountId }
}

export async function updateCashBox(id, data) {
  await query(
    'UPDATE cash_boxes SET name_ar = $2, name_en = $3, cash_box_group_id = $4 WHERE id = $1',
    [id, data.name_ar, data.name_en || null, data.cash_box_group_id]
  )
  const { rows } = await query('SELECT account_id FROM cash_boxes WHERE id = $1', [id])
  if (rows[0]?.account_id) {
    await query(
      'UPDATE accounting_accounts SET name_ar = $2, name_en = $3 WHERE id = $1',
      [rows[0].account_id, data.name_ar, data.name_en || null]
    )
  }
}

export async function deleteCashBox(id) {
  const { rows } = await query('SELECT account_id FROM cash_boxes WHERE id = $1', [id])
  await query('DELETE FROM cash_boxes WHERE id = $1', [id])
  if (rows[0]?.account_id) {
    await query('DELETE FROM accounting_accounts WHERE id = $1', [rows[0].account_id])
  }
}

export async function listBankGroups(search = '') {
  const like = `%${search}%`
  const { rows } = search
    ? await query('SELECT * FROM bank_groups WHERE name_ar LIKE $1 ORDER BY code', [like])
    : await query('SELECT * FROM bank_groups ORDER BY code')
  return rows
}

export async function createBankGroup(data) {
  const { insertId } = await query(
    'INSERT INTO bank_groups (code, name_ar, name_en) VALUES ($1, $2, $3)',
    [data.code, data.name_ar, data.name_en || null]
  )
  return { id: insertId }
}

export async function updateBankGroup(id, data) {
  await query(
    'UPDATE bank_groups SET name_ar = $2, name_en = $3, code = $4 WHERE id = $1',
    [id, data.name_ar, data.name_en || null, data.code]
  )
}

export async function deleteBankGroup(id) {
  await query('DELETE FROM bank_groups WHERE id = $1', [id])
}

export async function listBanks(search = '') {
  const like = `%${search}%`
  const { rows } = await query(
    `SELECT b.*, bg.name_ar AS bank_group_name, aa.name_ar AS account_name
     FROM banks b
     LEFT JOIN bank_groups bg ON bg.id = b.bank_group_id
     LEFT JOIN accounting_accounts aa ON aa.id = b.account_id
     ${search ? 'WHERE b.name_ar LIKE $1 OR b.code LIKE $1' : ''}
     ORDER BY b.id DESC`,
    search ? [like] : []
  )
  return rows.map((r) => ({ ...r, user_name: null, branch_name: null }))
}

export async function createBank(data) {
  const accountId = await createLinkedSubAccount({
    parentId: data.parent_account_id,
    name_ar: data.name_ar,
    name_en: data.name_en,
    entityType: 'bank',
    entityId: null,
    created_by: data.created_by || null,
  })
  const { insertId } = await query(
    `INSERT INTO banks (name_ar, name_en, code, bank_group_id, account_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.name_ar, data.name_en || null, data.code, data.bank_group_id, accountId, data.created_by || null]
  )
  await query('UPDATE accounting_accounts SET entity_id = $1 WHERE id = $2', [insertId, accountId])
  return { id: insertId }
}

export async function deleteBank(id) {
  const { rows } = await query('SELECT account_id FROM banks WHERE id = $1', [id])
  await query('DELETE FROM banks WHERE id = $1', [id])
  if (rows[0]?.account_id) {
    await query('DELETE FROM accounting_accounts WHERE id = $1', [rows[0].account_id])
  }
}

async function insertJournalLine(line) {
  await query(
    `INSERT INTO journal_entries
     (journal_type_id, reference_type, reference_id, journal_date, currency_id, account_id, debit, credit, notes, cost_center_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      line.journal_type_id || null,
      line.reference_type,
      line.reference_id,
      line.journal_date,
      line.currency_id,
      line.account_id,
      line.debit || 0,
      line.credit || 0,
      line.notes || null,
      line.cost_center_id || null,
    ]
  )
}

async function resolveCashOrBankAccountId({ type, cashBoxId, bankId }) {
  if (type === 'cash' && cashBoxId) {
    const { rows } = await query('SELECT account_id FROM cash_boxes WHERE id = $1', [cashBoxId])
    return rows[0]?.account_id
  }
  if (type === 'bank' && bankId) {
    const { rows } = await query('SELECT account_id FROM banks WHERE id = $1', [bankId])
    return rows[0]?.account_id
  }
  return null
}

export async function listReceiptVouchers() {
  const { rows } = await query(
    `SELECT rv.*, c.name_ar AS currency_name, aa.name_ar AS account_name,
            TRIM(CONCAT_WS(' ', NULLIF(TRIM(u.name), ''), NULLIF(TRIM(u.role), ''))) AS user_name
     FROM receipt_vouchers rv
     LEFT JOIN currencies c ON c.id = rv.currency_id
     LEFT JOIN accounting_accounts aa ON aa.id = rv.account_id
     LEFT JOIN platform_users u ON u.id = rv.created_by
     ORDER BY rv.id DESC`
  )
  return rows.map((r) => ({ ...r, branch_name: null }))
}

export async function createReceiptVoucher(data) {
  const sourceAccountId = await resolveCashOrBankAccountId({
    type: data.receipt_type,
    cashBoxId: data.cash_box_account_id,
    bankId: data.bank_account_id,
  })
  if (!sourceAccountId) throw new Error('حساب الصندوق أو البنك غير صالح')

  const { insertId } = await query(
    `INSERT INTO receipt_vouchers
     (voucher_no, voucher_date, receipt_type, cash_box_account_id, bank_account_id, transfer_no,
      currency_id, amount, account_id, analytic_account_id, cost_center_id, journal_type_id, notes, handling, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      data.voucher_no || String(Date.now()),
      data.voucher_date,
      data.receipt_type,
      data.cash_box_account_id || null,
      data.bank_account_id || null,
      data.transfer_no || null,
      data.currency_id,
      data.amount,
      data.account_id,
      data.analytic_account_id || null,
      data.cost_center_id || null,
      data.journal_type_id || null,
      data.notes || null,
      data.handling || 0,
      data.created_by || null,
    ]
  )

  const base = {
    journal_type_id: data.journal_type_id || 1,
    reference_type: 'receipt',
    reference_id: insertId,
    journal_date: data.voucher_date,
    currency_id: data.currency_id,
    notes: data.notes || 'سند قبض',
  }
  await insertJournalLine({ ...base, account_id: sourceAccountId, debit: data.amount, credit: 0 })
  await insertJournalLine({ ...base, account_id: data.account_id, debit: 0, credit: data.amount })
  return { id: insertId }
}

export async function deleteReceiptVoucher(id) {
  await query('DELETE FROM journal_entries WHERE reference_type = $1 AND reference_id = $2', ['receipt', id])
  await query('DELETE FROM receipt_vouchers WHERE id = $1', [id])
}

export async function listPaymentVouchers() {
  const { rows } = await query(
    `SELECT pv.*, c.name_ar AS currency_name, aa.name_ar AS account_name,
            TRIM(CONCAT_WS(' ', NULLIF(TRIM(u.name), ''), NULLIF(TRIM(u.role), ''))) AS user_name
     FROM payment_vouchers pv
     LEFT JOIN currencies c ON c.id = pv.currency_id
     LEFT JOIN accounting_accounts aa ON aa.id = pv.account_id
     LEFT JOIN platform_users u ON u.id = pv.created_by
     ORDER BY pv.id DESC`
  )
  return rows.map((r) => ({ ...r, branch_name: null, paymentTypeName: null }))
}

export async function createPaymentVoucher(data) {
  const sourceAccountId = await resolveCashOrBankAccountId({
    type: data.payment_type,
    cashBoxId: data.cash_box_account_id,
    bankId: data.bank_account_id,
  })
  if (!sourceAccountId) throw new Error('حساب الصندوق أو البنك غير صالح')

  const { insertId } = await query(
    `INSERT INTO payment_vouchers
     (voucher_no, voucher_date, payment_type, cash_box_account_id, bank_account_id, transfer_no,
      currency_id, amount, account_id, analytic_account_id, cost_center_id, journal_type_id, notes, handling, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      data.voucher_no || String(Date.now()),
      data.voucher_date,
      data.payment_type,
      data.cash_box_account_id || null,
      data.bank_account_id || null,
      data.transfer_no || null,
      data.currency_id,
      data.amount,
      data.account_id,
      data.analytic_account_id || null,
      data.cost_center_id || null,
      data.journal_type_id || null,
      data.notes || null,
      data.handling || 0,
      data.created_by || null,
    ]
  )

  const base = {
    journal_type_id: data.journal_type_id || 1,
    reference_type: 'payment',
    reference_id: insertId,
    journal_date: data.voucher_date,
    currency_id: data.currency_id,
    notes: data.notes || 'سند صرف',
  }
  await insertJournalLine({ ...base, account_id: data.account_id, debit: data.amount, credit: 0 })
  await insertJournalLine({ ...base, account_id: sourceAccountId, debit: 0, credit: data.amount })
  return { id: insertId }
}

export async function deletePaymentVoucher(id) {
  await query('DELETE FROM journal_entries WHERE reference_type = $1 AND reference_id = $2', ['payment', id])
  await query('DELETE FROM payment_vouchers WHERE id = $1', [id])
}

export async function listJournalEntriesGrouped() {
  const { rows } = await query(
    `SELECT je.reference_id, je.reference_type, je.journal_date,
            MAX(je.notes) AS notes,
            MAX(c.name_ar) AS currency_name,
            SUM(CASE WHEN je.debit > 0 THEN je.debit ELSE 0 END) AS amount,
            MAX(CASE WHEN je.debit > 0 THEN aa.name_ar END) AS from_account,
            MAX(CASE WHEN je.credit > 0 THEN aa.name_ar END) AS to_account
     FROM journal_entries je
     LEFT JOIN accounting_accounts aa ON aa.id = je.account_id
     LEFT JOIN currencies c ON c.id = je.currency_id
     GROUP BY je.reference_id, je.reference_type, je.journal_date
     ORDER BY je.journal_date DESC, je.reference_id DESC`
  )
  return rows.map((r, idx) => ({
    id: idx + 1,
    reference_id: r.reference_id,
    reference_type: r.reference_type,
    journal_date: r.journal_date,
    amount: Number(r.amount),
    currency_name: r.currency_name,
    from_account: r.from_account || '',
    to_account: r.to_account || '',
    notes: r.notes || '',
    user_name: '—',
    branch_name: '—',
  }))
}

export async function createJournalEntryLine(data) {
  await insertJournalLine(data)
}

export async function deleteJournalEntriesByRef(ref) {
  await query('DELETE FROM journal_entries WHERE reference_id = $1', [ref])
}

export async function deleteJournalEntry(id) {
  await query('DELETE FROM journal_entries WHERE id = $1', [id])
}

export async function updateJournalEntry(id, data) {
  await query(
    `UPDATE journal_entries SET journal_date=$2, currency_id=$3, account_id=$4, debit=$5, credit=$6, notes=$7 WHERE id=$1`,
    [id, data.journal_date, data.currency_id, data.account_id, data.debit || 0, data.credit || 0, data.notes || null]
  )
}

export async function listAccountCeilings() {
  const { rows } = await query(
    `SELECT ac.*, aa.name_ar AS account_name, ag.name_ar AS group_name, c.name_ar AS currency_name
     FROM account_ceilings ac
     LEFT JOIN accounting_accounts aa ON aa.id = ac.account_id
     LEFT JOIN account_groups ag ON ag.id = ac.account_group_id
     LEFT JOIN currencies c ON c.id = ac.currency_id
     ORDER BY ac.id DESC`
  )
  return rows.map((r) => ({
    ...r,
    account_type: r.account_nature,
    limit_action: r.exceed_action,
    branch_name: null,
  }))
}

export async function createAccountCeiling(data) {
  const { insertId } = await query(
    `INSERT INTO account_ceilings
     (scope, account_id, account_group_id, currency_id, ceiling_amount, account_nature, exceed_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      data.scope,
      data.account_id || null,
      data.account_group_id || null,
      data.currency_id,
      data.ceiling_amount,
      data.account_nature || 'debit',
      data.exceed_action || 'block',
    ]
  )
  return { id: insertId }
}

export async function updateAccountCeiling(id, data) {
  await query(
    `UPDATE account_ceilings SET currency_id=$2, ceiling_amount=$3, account_nature=$4, exceed_action=$5 WHERE id=$1`,
    [id, data.currency_id, data.ceiling_amount, data.account_nature, data.exceed_action]
  )
}

export async function deleteAccountCeiling(id) {
  await query('DELETE FROM account_ceilings WHERE id = $1', [id])
}

export async function getTransitAccounts() {
  const { rows } = await query('SELECT * FROM transit_account_settings WHERE id = 1')
  const row = rows[0] || {}
  if (!row.card_income_account && row.commission_income_account) {
    row.card_income_account = row.commission_income_account
  }
  return row
}

export async function postCardBatchDeliveryJournal({
  batchId,
  agentAccountId,
  total,
  description,
  journalDate,
}) {
  const settings = await getTransitAccounts()
  const transitAccountId = settings.card_income_account || settings.commission_income_account
  if (!transitAccountId) {
    throw new Error('حدّد حساب وسيط إيرادات الكروت من إعدادات الحسابات الوسيطة')
  }
  if (!agentAccountId) {
    throw new Error('الوكيل غير مرتبط بحساب فرعي في المحاسبة')
  }

  const amount = Number(total)
  if (!amount || amount <= 0) throw new Error('قيمة الدفعة غير صالحة')

  const { rows: currencyRows } = await query(
    'SELECT id FROM currencies WHERE is_local = 1 LIMIT 1'
  )
  const currencyId = currencyRows[0]?.id || 1

  const base = {
    journal_type_id: 1,
    reference_type: 'card_batch',
    reference_id: batchId,
    journal_date: journalDate || new Date().toISOString().slice(0, 10),
    currency_id: currencyId,
    notes: String(description || '').slice(0, 500),
  }

  await insertJournalLine({ ...base, account_id: transitAccountId, debit: amount, credit: 0 })
  await insertJournalLine({ ...base, account_id: agentAccountId, debit: 0, credit: amount })
}

export async function saveTransitAccounts(data) {
  await query(
    `INSERT INTO transit_account_settings
     (id, commission_income_account, card_income_account, courier_commission_account, transfer_guarantee_account,
      currency_exchange_account, customer_guarantee_account, customer_credit_account, coupon_discount_account)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8)
     ON DUPLICATE KEY UPDATE
      commission_income_account=VALUES(commission_income_account),
      card_income_account=VALUES(card_income_account),
      courier_commission_account=VALUES(courier_commission_account),
      transfer_guarantee_account=VALUES(transfer_guarantee_account),
      currency_exchange_account=VALUES(currency_exchange_account),
      customer_guarantee_account=VALUES(customer_guarantee_account),
      customer_credit_account=VALUES(customer_credit_account),
      coupon_discount_account=VALUES(coupon_discount_account)`,
    [
      data.commission_income_account || null,
      data.card_income_account || null,
      data.courier_commission_account || null,
      data.transfer_guarantee_account || null,
      data.currency_exchange_account || null,
      data.customer_guarantee_account || null,
      data.customer_credit_account || null,
      data.coupon_discount_account || null,
    ]
  )
}

export async function listCurrencyExchanges() {
  const { rows } = await query(
    `SELECT ce.*,
            fc.name_ar AS from_currency_name, tc.name_ar AS to_currency_name,
            fa.name_ar AS from_account_name, ta.name_ar AS to_account_name
     FROM currency_exchanges ce
     LEFT JOIN currencies fc ON fc.id = ce.from_currency_id
     LEFT JOIN currencies tc ON tc.id = ce.to_currency_id
     LEFT JOIN accounting_accounts fa ON fa.id = ce.from_account_id
     LEFT JOIN accounting_accounts ta ON ta.id = ce.to_account_id
     ORDER BY ce.id DESC`
  )
  return rows.map((r) => ({
    id: r.id,
    date: r.exchange_date,
    type: r.exchange_type,
    from_text: `${r.from_currency_name} / ${r.from_account_name}`,
    to_text: `${r.to_currency_name} / ${r.to_account_name}`,
    rate: Number(r.rate),
    notes: r.notes || '',
  }))
}

export async function executeCurrencyExchange(data) {
  const { insertId } = await query(
    `INSERT INTO currency_exchanges
     (exchange_date, exchange_type, from_currency_id, to_currency_id, from_account_id, to_account_id, from_amount, to_amount, rate, notes)
     VALUES ($1,'exchange',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      data.journal_date,
      data.from_currency_id,
      data.to_currency_id,
      data.from_account_id,
      data.to_account_id,
      data.amount,
      data.amount * data.rate,
      data.rate,
      data.notes || null,
    ]
  )
  const refId = insertId
  const base = {
    reference_type: 'exchange',
    reference_id: refId,
    journal_date: data.journal_date,
    notes: data.notes || 'مصارفة عملة',
  }
  await insertJournalLine({
    ...base,
    currency_id: data.from_currency_id,
    account_id: data.from_account_id,
    debit: 0,
    credit: data.amount,
  })
  await insertJournalLine({
    ...base,
    currency_id: data.to_currency_id,
    account_id: data.to_account_id,
    debit: data.amount * data.rate,
    credit: 0,
  })
  return { id: insertId }
}

export async function getAccountStatement(payload) {
  const conditions = []
  const params = []

  if (payload.account_id) {
    params.push(payload.account_id)
    conditions.push(`je.account_id = $${params.length}`)
  } else if (payload.main_account_id) {
    params.push(payload.main_account_id)
    conditions.push(`(aa.id = $${params.length} OR aa.parent_id = $${params.length})`)
  }

  if (payload.currency_id) {
    params.push(payload.currency_id)
    conditions.push(`je.currency_id = $${params.length}`)
  }

  if (payload.from_date) {
    params.push(payload.from_date)
    conditions.push(`je.journal_date >= $${params.length}`)
  }
  if (payload.to_date) {
    params.push(payload.to_date)
    conditions.push(`je.journal_date <= $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  let openingBalance = 0
  if (payload.detailed_type !== 'no_open' && payload.from_date && payload.account_id) {
    const { rows: openRows } = await query(
      `SELECT COALESCE(SUM(debit),0) AS deb, COALESCE(SUM(credit),0) AS cre
       FROM journal_entries WHERE account_id = $1 AND journal_date < $2`,
      [payload.account_id, payload.from_date]
    )
    openingBalance = Number(openRows[0]?.deb || 0) - Number(openRows[0]?.cre || 0)
  }

  const { rows } = await query(
    `SELECT je.id, je.journal_date, je.debit, je.credit, je.notes, je.reference_type, je.reference_id,
            aa.name_ar AS account_name, c.name_ar AS currency_name, c.id AS currency_id
     FROM journal_entries je
     INNER JOIN accounting_accounts aa ON aa.id = je.account_id
     LEFT JOIN currencies c ON c.id = je.currency_id
     ${where}
     ORDER BY je.journal_date, je.id`,
    params
  )

  const list = []
  if (openingBalance !== 0 && payload.report_mode === 'detailed') {
    list.push({
      id: 0,
      journal_date: payload.from_date,
      account_name: 'رصيد سابق',
      debit: 0,
      credit: 0,
      notes: '',
      balance: openingBalance,
      reference_type: 'opening',
      reference_id: null,
      is_opening: true,
      currency_name: rows[0]?.currency_name || '',
    })
  }

  let running = openingBalance
  for (const row of rows) {
    running += Number(row.debit || 0) - Number(row.credit || 0)
    list.push({
      id: row.id,
      journal_date: row.journal_date,
      account_name: row.account_name,
      debit: Number(row.debit),
      credit: Number(row.credit),
      notes: row.notes || '',
      balance: running,
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      currency_name: row.currency_name,
      currency_id: row.currency_id,
    })
  }

  return list
}
