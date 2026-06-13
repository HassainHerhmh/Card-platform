export const ROUTER_SOURCE = {
  HOTSPOT: 'hotspot',
  USER_MANAGER: 'user-manager',
}

export function normalizeRouterSource(value) {
  return value === ROUTER_SOURCE.USER_MANAGER
    ? ROUTER_SOURCE.USER_MANAGER
    : ROUTER_SOURCE.HOTSPOT
}

export function routerSourceLabel(source) {
  return normalizeRouterSource(source) === ROUTER_SOURCE.USER_MANAGER
    ? 'User Manager'
    : 'Hotspot'
}

export function routerSourceLabelAr(source) {
  return normalizeRouterSource(source) === ROUTER_SOURCE.USER_MANAGER
    ? 'يوزر منجر'
    : 'هوتسبوت'
}
