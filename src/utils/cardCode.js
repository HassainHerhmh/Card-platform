const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function randomDigit() {
  return String(Math.floor(Math.random() * 10))
}

function randomLetter() {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)]
}

export function generateCardCode({ digits = 8, chars = 0 } = {}) {
  const digitCount = Math.max(1, Math.min(Number(digits) || 8, 20))
  const letterCount = Math.max(0, Math.min(Number(chars) || 0, 10))

  let code = Array.from({ length: digitCount }, randomDigit).join('')

  for (let i = 0; i < letterCount; i += 1) {
    const pos = Math.floor(Math.random() * (code.length + 1))
    code = code.slice(0, pos) + randomLetter() + code.slice(pos)
  }

  return code
}

export const CARD_FORMAT = {
  EMPTY_PASSWORD: 'empty_password',
  SAME: 'same',
  DIFFERENT: 'different',
}

export function buildCardCredentials({
  prefix = '',
  suffix = '',
  format = CARD_FORMAT.EMPTY_PASSWORD,
  digits = 8,
  chars = 0,
} = {}) {
  const cardPrefix = String(prefix)
  const cardSuffix = String(suffix)
  const fixedLength = cardPrefix.length + cardSuffix.length
  const configuredDigits = Math.max(1, Math.min(Number(digits) || 8, 20))
  const configuredChars = Math.max(0, Math.min(Number(chars) || 0, 10))

  if (fixedLength >= configuredDigits && configuredChars === 0) {
    throw new Error('البادئة والنهاية يجب أن يكون طولهما أقل من عدد الأرقام المحدد في إعدادات الكود')
  }

  const coreDigits = Math.max(0, configuredDigits - fixedLength)
  const rawCode = coreDigits > 0 || configuredChars > 0
    ? generateCardCode({ digits: Math.max(1, coreDigits), chars: configuredChars })
    : ''

  const username = `${cardPrefix}${rawCode}${cardSuffix}`

  if (format === CARD_FORMAT.EMPTY_PASSWORD) {
    return { username, password: '' }
  }

  if (format === CARD_FORMAT.DIFFERENT) {
    return {
      username,
      password: generateCardCode({ digits: configuredDigits, chars: configuredChars }),
    }
  }

  return { username, password: username }
}
