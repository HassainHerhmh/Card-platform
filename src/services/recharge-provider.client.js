const BALANCE_ACTIONS = ['balance', 'Balance', 'querybalance', 'getbalance']
const REQUEST_TIMEOUT_MS = 20000

const HTTP_STATUS_MESSAGES = {
  400: 'طلب غير صالح من المزود',
  401: 'بيانات الدخول غير صحيحة',
  403: 'مرفوض من المزود — تحقق من IP أو بيانات الربط',
  404: 'رابط المزود غير صحيح',
  500: 'خطأ في سيرفر المزود',
  502: 'السيرفر الوسيط لا يستجيب',
  503: 'المزود غير متاح حالياً',
}

function normalizeBaseUrl(apiUrl) {
  const trimmed = String(apiUrl || '').trim()
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function buildBalanceRequest(provider, action) {
  const base = normalizeBaseUrl(provider.apiUrl)
  if (!base) throw new Error('رابط المزود غير مضبوط')

  const params = new URLSearchParams()
  params.set('action', action)

  const providerType = String(provider.providerType || provider.provider_type || '').trim()
  if (providerType) params.set('type', providerType)

  const userid = String(provider.username || provider.accountNumber || '').trim()
  if (userid) params.set('userid', userid)
  if (provider.password) params.set('password', provider.password)
  if (provider.token) params.set('token', provider.token)
  if (provider.accountNumber) params.set('account', provider.accountNumber)

  return `${base}?${params.toString()}`
}

function extractNumber(value) {
  const cleaned = String(value).replace(/,/g, '').trim()
  const match = cleaned.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const num = Number(match[0])
  return Number.isFinite(num) ? num : null
}

function isHttpStatusBody(text) {
  const trimmed = String(text || '').trim()
  return /^(?:40[0-9]|50[0-9])$/.test(trimmed)
}

function httpStatusError(status, text) {
  const base = HTTP_STATUS_MESSAGES[status] || `خطأ HTTP ${status} من المزود`
  const body = String(text || '').trim()
  if (body && body !== String(status) && !isHttpStatusBody(body)) {
    return { ok: false, error: `${base}: ${body.slice(0, 120)}`, connectionIssue: true, httpStatus: status }
  }
  return { ok: false, error: base, connectionIssue: true, httpStatus: status }
}

function isPlausibleBalance(num, rawText) {
  const trimmed = String(rawText || '').trim()
  if (isHttpStatusBody(trimmed)) return false
  if (Number.isInteger(num) && num >= 400 && num <= 599 && trimmed === String(num)) return false
  return true
}

function parseBalanceResponse(text, httpStatus) {
  if (httpStatus >= 400) {
    return httpStatusError(httpStatus, text)
  }

  const trimmed = String(text || '').trim()
  if (!trimmed) {
    return { ok: false, error: 'استجابة فارغة من المزود', connectionIssue: true }
  }

  if (isHttpStatusBody(trimmed)) {
    return httpStatusError(Number(trimmed), trimmed)
  }

  try {
    const json = JSON.parse(trimmed)
    const errorText = json.message || json.msg || json.error || json.Error
    const status = String(json.result || json.status || json.success || '').toLowerCase()

    if (status.includes('error') || status === '0' || status === 'false' || json.success === false) {
      return {
        ok: false,
        error: errorText || 'رفض المزود الاستعلام — تحقق من بيانات الربط',
        connectionIssue: true,
        raw: trimmed,
      }
    }

    const balanceKeys = ['balance', 'Balance', 'BALANCE', 'rslt', 'amount', 'credit', 'data']
    for (const key of balanceKeys) {
      if (json[key] != null) {
        const num = extractNumber(json[key])
        if (num !== null && isPlausibleBalance(num, json[key])) {
          return { ok: true, balance: num, raw: trimmed }
        }
      }
    }

    const code = Number(json.code ?? json.statusCode ?? json.httpStatus)
    if (code >= 400 && code <= 599) {
      return httpStatusError(code, errorText || trimmed)
    }

    if (errorText && /error|fail|invalid|wrong|unauthorized|خطأ|فشل/i.test(String(errorText))) {
      return {
        ok: false,
        error: String(errorText),
        connectionIssue: true,
        raw: trimmed,
      }
    }
  } catch {
    // plain text response
  }

  if (/error|fail|invalid|wrong|unauthorized|خطأ|فشل|incorrect|denied|timeout/i.test(trimmed)) {
    return {
      ok: false,
      error: trimmed.slice(0, 300),
      connectionIssue: true,
      raw: trimmed,
    }
  }

  const num = extractNumber(trimmed)
  if (num !== null && isPlausibleBalance(num, trimmed)) {
    return { ok: true, balance: num, raw: trimmed }
  }

  return {
    ok: false,
    error: 'تعذر قراءة رصيد المزود من الاستجابة',
    connectionIssue: true,
    raw: trimmed.slice(0, 300),
  }
}

async function fetchBalanceUrl(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    })
    const text = await response.text()
    return { text, status: response.status }
  } finally {
    clearTimeout(timer)
  }
}

export async function queryProviderBalance(provider) {
  if (!provider?.apiUrl?.trim()) {
    return { ok: false, error: 'رابط المزود غير مضبوط', connectionIssue: true }
  }
  if (!provider.username?.trim() && !provider.accountNumber?.trim()) {
    return { ok: false, error: 'اسم المستخدم أو رقم الحساب مطلوب للاستعلام', connectionIssue: true }
  }
  if (!provider.password) {
    return { ok: false, error: 'كلمة المرور مطلوبة للاستعلام', connectionIssue: true }
  }

  let lastError = null

  for (const action of BALANCE_ACTIONS) {
    try {
      const url = buildBalanceRequest(provider, action)
      const { text, status } = await fetchBalanceUrl(url)

      if (status >= 400) {
        lastError = httpStatusError(status, text)
        continue
      }

      const parsed = parseBalanceResponse(text, status)

      if (parsed.ok) {
        return {
          ok: true,
          balance: parsed.balance,
          action,
          queriedAt: new Date().toISOString(),
        }
      }

      lastError = parsed
      if (status >= 500) continue
      if (parsed.connectionIssue && parsed.error) lastError = parsed
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'انتهت مهلة الاتصال بالمزود'
        : (error.message || 'تعذر الاتصال بالمزود')
      lastError = { ok: false, error: message, connectionIssue: true }
    }
  }

  return lastError || {
    ok: false,
    error: 'تعذر استعلام رصيد المزود — تحقق من إعدادات الربط',
    connectionIssue: true,
  }
}
