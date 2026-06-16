import { query } from '../db/pool.js'

export const DEFAULT_PRINT_TEMPLATE = {
  name: 'default',
  designMode: 'scratch',
  cardWidthMm: 68.8,
  cardHeightMm: 17,
  marginHMm: 0.4,
  marginVMm: 0.5,
  currency: 'ريال',
  contactText: '',
  info1: '',
  info2: '',
  logoUrl: '',
  backgroundImage: '',
  border: { enabled: true, size: 1, color: '#000000' },
  pageLayout: { cardsPerPage: 51, columns: 3 },
  elements: {
    username: { enabled: true, label: 'اسم المستخدم', x: 22, y: 5, fontSize: 10, fontFamily: 'Arial', bold: true, italic: false, color: '#000000' },
    password: { enabled: false, label: 'كلمة السر', x: 5, y: 10, fontSize: 9, fontFamily: 'Arial', bold: false, italic: false, color: '#000000' },
    duration: { enabled: false, label: 'الوقت', x: 5, y: 10, fontSize: 9, fontFamily: 'Arial', bold: false, italic: false, color: '#000000' },
    dataQuota: { enabled: false, label: 'الحجم', x: 30, y: 10, fontSize: 9, fontFamily: 'Arial', bold: false, italic: false, color: '#000000' },
    validity: { enabled: false, label: 'الصلاحية', x: 45, y: 10, fontSize: 9, fontFamily: 'Arial', bold: false, italic: false, color: '#000000' },
    serialNumber: { enabled: false, label: 'رقم تسلسل', x: 55, y: 2, fontSize: 8, fontFamily: 'Arial', bold: false, italic: false, color: '#444444' },
    price: { enabled: false, label: 'السعر', x: 5, y: 2, fontSize: 9, fontFamily: 'Arial', bold: true, italic: false, color: '#000000' },
    barcode: { enabled: false, label: 'باركود', x: 10, y: 8, fontSize: 8, fontFamily: 'Libre Barcode 39 Text', bold: false, italic: false, color: '#000000' },
    printDate: { enabled: false, label: 'تاريخ الطباعة', x: 45, y: 2, fontSize: 7, fontFamily: 'Arial', bold: false, italic: false, color: '#666666' },
    contact: { enabled: false, label: 'تواصل', x: 5, y: 14, fontSize: 7, fontFamily: 'Arial', bold: false, italic: false, color: '#333333' },
    info1: { enabled: false, label: 'معلومات 1', x: 30, y: 14, fontSize: 7, fontFamily: 'Arial', bold: false, italic: false, color: '#333333' },
    info2: { enabled: false, label: 'معلومات 2', x: 50, y: 14, fontSize: 7, fontFamily: 'Arial', bold: false, italic: false, color: '#333333' },
    logo: { enabled: false, label: 'شعار', x: 2, y: 2, fontSize: 10, fontFamily: 'Arial', bold: false, italic: false, color: '#000000', width: 12, height: 12 },
  },
}

function parseConfig(raw) {
  if (!raw) return { ...DEFAULT_PRINT_TEMPLATE }
  if (typeof raw === 'object') return { ...DEFAULT_PRINT_TEMPLATE, ...raw }
  try {
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_PRINT_TEMPLATE,
      ...parsed,
      border: { ...DEFAULT_PRINT_TEMPLATE.border, ...(parsed.border || {}) },
      pageLayout: { ...DEFAULT_PRINT_TEMPLATE.pageLayout, ...(parsed.pageLayout || {}) },
      elements: {
        ...DEFAULT_PRINT_TEMPLATE.elements,
        ...(parsed.elements || {}),
      },
    }
  } catch {
    return { ...DEFAULT_PRINT_TEMPLATE }
  }
}

function mapRow(row) {
  const config = parseConfig(row.config)
  return {
    id: row.id,
    name: row.name,
    isDefault: Boolean(row.is_default),
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function ensureDefaultTemplate() {
  const { rows } = await query('SELECT id FROM print_templates LIMIT 1')
  if (rows.length) return

  await query(
    `INSERT INTO print_templates (name, is_default, config) VALUES ($1, 1, $2)`,
    [DEFAULT_PRINT_TEMPLATE.name, JSON.stringify(DEFAULT_PRINT_TEMPLATE)]
  )
}

export async function listPrintTemplates() {
  await ensureDefaultTemplate()
  const { rows } = await query(
    'SELECT id, name, is_default, config, created_at, updated_at FROM print_templates ORDER BY is_default DESC, name ASC'
  )
  return rows.map(mapRow)
}

export async function getPrintTemplate(id) {
  const { rows } = await query(
    'SELECT id, name, is_default, config, created_at, updated_at FROM print_templates WHERE id = $1',
    [id]
  )
  if (!rows[0]) throw new Error('القالب غير موجود')
  return mapRow(rows[0])
}

export async function getDefaultPrintTemplate() {
  await ensureDefaultTemplate()
  const { rows } = await query(
    'SELECT id, name, is_default, config, created_at, updated_at FROM print_templates WHERE is_default = 1 ORDER BY id ASC LIMIT 1'
  )
  if (rows[0]) return mapRow(rows[0])
  const all = await listPrintTemplates()
  return all[0]
}

export async function createPrintTemplate({ name, config, isDefault = false }) {
  const templateName = String(name || '').trim() || 'قالب جديد'
  if (isDefault) {
    await query('UPDATE print_templates SET is_default = 0')
  }
  const { insertId } = await query(
    `INSERT INTO print_templates (name, is_default, config) VALUES ($1, $2, $3)`,
    [templateName, isDefault ? 1 : 0, JSON.stringify(parseConfig(config))]
  )
  return getPrintTemplate(insertId)
}

export async function updatePrintTemplate(id, { name, config, isDefault = false }) {
  const existing = await getPrintTemplate(id)
  const templateName = name != null ? String(name).trim() || existing.name : existing.name
  const nextConfig = config != null ? parseConfig(config) : existing.config

  if (isDefault) {
    await query('UPDATE print_templates SET is_default = 0')
  }

  await query(
    `UPDATE print_templates SET name = $1, is_default = $2, config = $3 WHERE id = $4`,
    [templateName, isDefault ? 1 : 0, JSON.stringify(nextConfig), id]
  )
  return getPrintTemplate(id)
}

export async function deletePrintTemplate(id) {
  const existing = await getPrintTemplate(id)
  if (existing.isDefault) {
    throw new Error('لا يمكن حذف القالب الافتراضي')
  }
  await query('DELETE FROM print_templates WHERE id = $1', [id])
  return { deleted: true }
}
