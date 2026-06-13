export function parsePositiveInt(value) {
  const id = Number.parseInt(String(value), 10)
  if (!Number.isInteger(id) || id <= 0) return null
  return id
}
