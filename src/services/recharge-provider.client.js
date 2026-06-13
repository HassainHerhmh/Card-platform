const BALANCE_ACTIONS = ['balance', 'Balance', 'querybalance', 'getbalance']
const REQUEST_TIMEOUT_MS = 20000

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

function parseBalanceResponse(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) {
    return { ok: false, error: 'استجابة فارغة من المزود', connectionIssue: true }
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
        if (num !== null) {
          return { ok: true, balance: num, raw: trimmed }
        }
      }
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
  if (num !== null) {
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
      const parsed = parseBalanceResponse(text)

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
