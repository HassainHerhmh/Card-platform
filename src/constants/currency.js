export const CURRENCY_SYMBOL = 'ر.ي'
export const CURRENCY_NAME = 'ريال يمني'
export const LOCALE = 'ar-YE'

export function formatCurrency(amount) {
  return `${Number(amount || 0).toLocaleString(LOCALE)} ${CURRENCY_SYMBOL}`
}
