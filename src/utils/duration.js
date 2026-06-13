export function parseTimeHms(value) {
  if (!value || typeof value !== 'string') return null
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})$/)
  if (!match) return null
  return { hours: Number(match[1]) || 0, minutes: Number(match[2]) || 0 }
}

export function parseValidityPeriod(value) {
  if (value == null || value === '') return { hours: 24, minutes: 0 }

  const raw = String(value).trim().toLowerCase()
  if (/^\d+$/.test(raw)) {
    return { hours: Number(raw) * 24, minutes: 0 }
  }

  const hms = parseTimeHms(raw)
  if (hms) return hms

  let totalHours = 0
  const weeks = [...raw.matchAll(/(\d+)w/g)]
  const days = [...raw.matchAll(/(\d+)d/g)]
  for (const [, n] of weeks) totalHours += Number(n) * 7 * 24
  for (const [, n] of days) totalHours += Number(n) * 24

  if (totalHours > 0) return { hours: totalHours, minutes: 0 }
  return { hours: 24, minutes: 0 }
}

export function formatDurationLabel(hours = 0, minutes = 0) {
  const h = Math.max(0, Number(hours) || 0)
  const m = Math.max(0, Number(minutes) || 0)
  if (h === 0 && m === 0) return '24 ساعة'
  if (m === 0 && h >= 24 && h % 24 === 0) {
    const days = h / 24
    return days === 1 ? '1 يوم' : `${days} أيام`
  }
  const parts = []
  if (h > 0) parts.push(`${h} ساعة`)
  if (m > 0) parts.push(`${m} دقيقة`)
  return parts.join(' ')
}

export function normalizeDurationInput(hours, minutes) {
  let h = Math.max(0, Number(hours) || 0)
  let m = Math.max(0, Number(minutes) || 0)
  if (h === 0 && m === 0) {
    h = 24
    m = 0
  }
  if (m >= 60) {
    h += Math.floor(m / 60)
    m %= 60
  }
  return {
    durationHours: h,
    durationMinutes: m,
    duration: formatDurationLabel(h, m),
  }
}
