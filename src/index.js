import app from './app.js'
import { env } from './config/env.js'
import { migrate } from './db/migrate.js'
import { seed } from './db/seed.js'
import { refreshMikrotikConnectionCache } from './services/mikrotik-connection.service.js'

async function start() {
  try {
    await migrate()
    await seed()
    await refreshMikrotikConnectionCache()
  } catch (error) {
    console.error('Database init failed:', error.message)
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`API running on port ${env.port}`)
  })
}

start()
