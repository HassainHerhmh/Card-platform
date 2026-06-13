import { query } from '../db/pool.js'

const emptyProvider = {
  providerName: '',
  apiUrl: '',
  apiIp: '',
  accountNumber: '',
  username: '',
  password: '',
  token: '',
  employeeNote: '',
}

function mapProvider(row) {
  if (!row) return { ...emptyProvider }
  return {
    providerName: row.provider_name || '',
    apiUrl: row.api_url || '',
    apiIp: row.api_ip || '',
    accountNumber: row.account_number || '',
    username: row.username || '',
    password: row.password || '',
    token: row.token || '',
    employeeNote: row.employee_note || '',
    updatedAt: row.updated_at,
  }
}

function mapCarrier(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    sortOrder: row.sort_order,
  }
}

function mapService(row) {
  return {
    id: row.id,
    carrierId: row.carrier_id,
    serviceCode: row.service_code,
    name: row.name,
    serviceType: row.service_type,
    price: Number(row.price),
    commissionPercent: Number(row.commission_percent),
    status: row.status,
  }
}

function mapProviderRow(row, enabledServiceIds = []) {
  if (!row) return null
  return {
    id: row.id,
    providerName: row.provider_name || '',
    apiUrl: row.api_url || '',
    apiIp: row.api_ip || '',
    accountNumber: row.account_number || '',
    username: row.username || '',
    password: row.password || '',
    token: row.token || '',
    employeeNote: row.employee_note || '',
    status: row.status || 'نشط',
    enabledServiceIds,
    servicesCount: enabledServiceIds.length,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }
}

async function getProviderServiceIds(providerId) {
  const { rows } = await query(
    'SELECT service_id FROM recharge_provider_services WHERE provider_id = $1',
    [providerId]
  )
  return rows.map((r) => r.service_id)
}

async function setProviderServices(providerId, serviceIds = []) {
  await query('DELETE FROM recharge_provider_services WHERE provider_id = $1', [providerId])
  const ids = [...new Set(serviceIds.map(Number).filter(Boolean))]
  for (const serviceId of ids) {
    await query(
      'INSERT INTO recharge_provider_services (provider_id, service_id) VALUES ($1, $2)',
      [providerId, serviceId]
    )
  }
}

export async function getProviders() {
  const { rows } = await query(
    'SELECT * FROM recharge_providers ORDER BY id DESC'
  )
  const providers = []
  for (const row of rows) {
    const enabledServiceIds = await getProviderServiceIds(row.id)
    providers.push(mapProviderRow(row, enabledServiceIds))
  }
  return providers
}

export async function getProviderById(id) {
  const { rows } = await query('SELECT * FROM recharge_providers WHERE id = $1', [id])
  if (!rows[0]) return null
  const enabledServiceIds = await getProviderServiceIds(id)
  return mapProviderRow(rows[0], enabledServiceIds)
}

export async function createProvider(data) {
  const {
    providerName,
    apiUrl = '',
    apiIp = '',
    accountNumber = '',
    username = '',
    password = '',
    token = '',
    employeeNote = '',
    status = 'نشط',
    enabledServiceIds = [],
  } = data

  const { insertId } = await query(
    `INSERT INTO recharge_providers
      (provider_name, api_url, api_ip, account_number, username, password, token, employee_note, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [providerName, apiUrl, apiIp, accountNumber, username, password, token, employeeNote, status]
  )

  await setProviderServices(insertId, enabledServiceIds)
  return getProviderById(insertId)
}

export async function updateProvider(id, data) {
  const existing = await getProviderById(id)
  if (!existing) return null

  const {
    providerName,
    apiUrl = '',
    apiIp = '',
    accountNumber = '',
    username = '',
    password = '',
    token = '',
    employeeNote = '',
    status = 'نشط',
    enabledServiceIds,
  } = data

  await query(
    `UPDATE recharge_providers SET
      provider_name = $1, api_url = $2, api_ip = $3, account_number = $4,
      username = $5, password = $6, token = $7, employee_note = $8, status = $9
     WHERE id = $10`,
    [providerName, apiUrl, apiIp, accountNumber, username, password, token, employeeNote, status, id]
  )

  if (enabledServiceIds !== undefined) {
    await setProviderServices(id, enabledServiceIds)
  }

  return getProviderById(id)
}

export async function deleteProvider(id) {
  await query('DELETE FROM recharge_providers WHERE id = $1', [id])
}

export async function getProviderConfig() {
  const { rows } = await query('SELECT * FROM recharge_provider_config WHERE id = 1')
  return mapProvider(rows[0])
}

export async function updateProviderConfig(data) {
  const {
    providerName = '',
    apiUrl = '',
    apiIp = '',
    accountNumber = '',
    username = '',
    password = '',
    token = '',
    employeeNote = '',
  } = data

  await query(
    `INSERT INTO recharge_provider_config
      (id, provider_name, api_url, api_ip, account_number, username, password, token, employee_note)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
     ON DUPLICATE KEY UPDATE
      provider_name = VALUES(provider_name),
      api_url = VALUES(api_url),
      api_ip = VALUES(api_ip),
      account_number = VALUES(account_number),
      username = VALUES(username),
      password = VALUES(password),
      token = VALUES(token),
      employee_note = VALUES(employee_note)`,
    [providerName, apiUrl, apiIp, accountNumber, username, password, token, employeeNote]
  )

  return getProviderConfig()
}

export async function getCarriers() {
  const { rows } = await query(
    'SELECT id, code, name, status, sort_order FROM recharge_carriers ORDER BY sort_order, id'
  )
  return rows.map(mapCarrier)
}

export async function createCarrier({ name, code }) {
  const carrierCode = (code || name).trim().toLowerCase().replace(/\s+/g, '_')
  const { insertId } = await query(
    'INSERT INTO recharge_carriers (code, name) VALUES ($1, $2)',
    [carrierCode, name.trim()]
  )
  const { rows } = await query(
    'SELECT id, code, name, status, sort_order FROM recharge_carriers WHERE id = $1',
    [insertId]
  )
  return mapCarrier(rows[0])
}

export async function updateCarrier(id, { name, status }) {
  await query(
    'UPDATE recharge_carriers SET name = $1, status = $2 WHERE id = $3',
    [name.trim(), status || 'نشط', id]
  )
  const { rows } = await query(
    'SELECT id, code, name, status, sort_order FROM recharge_carriers WHERE id = $1',
    [id]
  )
  return rows[0] ? mapCarrier(rows[0]) : null
}

export async function deleteCarrier(id) {
  await query('DELETE FROM recharge_carriers WHERE id = $1', [id])
}

export async function getServices(carrierId) {
  let sql = `
    SELECT s.id, s.carrier_id, s.service_code, s.name, s.service_type,
           s.price, s.commission_percent, s.status, c.name AS carrier_name
    FROM recharge_services s
    JOIN recharge_carriers c ON c.id = s.carrier_id
  `
  const params = []
  if (carrierId) {
    sql += ' WHERE s.carrier_id = $1'
    params.push(carrierId)
  }
  sql += ' ORDER BY c.sort_order, c.id, s.service_type, s.name'

  const { rows } = await query(sql, params)
  return rows.map((row) => ({
    ...mapService(row),
    carrierName: row.carrier_name,
  }))
}

export async function createService(data) {
  const {
    carrierId,
    serviceCode,
    name,
    serviceType = 'فوري',
    price = 0,
    commissionPercent = 0,
  } = data

  const { insertId } = await query(
    `INSERT INTO recharge_services
      (carrier_id, service_code, name, service_type, price, commission_percent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [carrierId, serviceCode.trim(), name.trim(), serviceType, price, commissionPercent]
  )

  const { rows } = await query(
    `SELECT s.id, s.carrier_id, s.service_code, s.name, s.service_type,
            s.price, s.commission_percent, s.status
     FROM recharge_services s WHERE s.id = $1`,
    [insertId]
  )
  return mapService(rows[0])
}

export async function updateService(id, data) {
  const {
    serviceCode,
    name,
    serviceType,
    price,
    commissionPercent,
    status,
  } = data

  await query(
    `UPDATE recharge_services SET
      service_code = $1, name = $2, service_type = $3,
      price = $4, commission_percent = $5, status = $6
     WHERE id = $7`,
    [serviceCode.trim(), name.trim(), serviceType, price, commissionPercent, status || 'نشط', id]
  )

  const { rows } = await query(
    `SELECT id, carrier_id, service_code, name, service_type, price, commission_percent, status
     FROM recharge_services WHERE id = $1`,
    [id]
  )
  return rows[0] ? mapService(rows[0]) : null
}

export async function deleteService(id) {
  await query('DELETE FROM recharge_services WHERE id = $1', [id])
}
