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

export function buildCardCredentials(rawCode, {
  prefix = '',
  suffix = '',
  format = CARD_FORMAT.EMPTY_PASSWORD,
  passwordSettings = {},
} = {}) {
  const username = `${prefix}${rawCode}${suffix}`

  if (format === CARD_FORMAT.EMPTY_PASSWORD) {
    return { username, password: '' }
  }

  if (format === CARD_FORMAT.DIFFERENT) {
    return {
      username,
      password: generateCardCode(passwordSettings),
    }
  }

  return { username, password: username }
}
