import { env } from '../config/env.js'

/**
 * طبقة الاتصال بميكروتك — كل بيانات الدخول تبقى في الباك اند فقط.
 * لاحقاً: استخدم مكتبة routeros-api أو REST API حسب إصدار RouterOS.
 */
export async function getRouterStatus() {
  const { host, user, password } = env.mikrotik

  if (!host || !user || !password) {
    return {
      connected: false,
      message: 'إعدادات الميكروتك غير مكتملة في ملف .env على السيرفر',
    }
  }

  // TODO: اتصال حقيقي بـ RouterOS API من السيرفر
  return {
    connected: true,
    host,
    identity: 'MikroTik-Router',
    message: 'جاهز للربط — أضف مكتبة RouterOS API هنا',
  }
}

export async function printHotspotUsers({ profiles, count }) {
  await getRouterStatus()

  // TODO: /ip/hotspot/user/add عبر API
  return {
    ok: true,
    printed: count,
    profiles,
    codes: Array.from({ length: count }, (_, i) => `CODE-${Date.now()}-${i + 1}`),
  }
}
