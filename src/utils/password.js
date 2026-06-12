import crypto from 'crypto'

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
const DIGITS = '23456789'
const CHARSET = LETTERS + DIGITS

export function generateStrongPassword(length = 9) {
  const chars = [
    LETTERS[crypto.randomInt(LETTERS.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
  ]

  for (let i = chars.length; i < length; i += 1) {
    chars.push(CHARSET[crypto.randomInt(CHARSET.length)])
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}
