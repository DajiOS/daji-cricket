import { loadConfig, configWarnings } from './config.ts';
import { openDb, closeDb } from './db.ts';
import { buildServer } from './app.ts';
import { seedDemo, hasAdmin } from './seed.ts';
import { startScheduler, stopScheduler } from './jobs.ts';
import { flushNotifications, registerProvider, setOtpSender, setOtpSmsSender } from './notifications.ts';
import { expoPushProvider } from './push.ts';
import { whatsappOtpSender, msg91OtpSender } from './whatsapp.ts';
import { gmailProvider } from './gmail.ts';

const cfg = loadConfig();
openDb(cfg.dbPath);
for (const w of configWarnings(cfg)) console.warn(`WARNING: ${w}`);
if (cfg.demoMode) {
  const r = seedDemo(cfg);
  if (r.created) console.log('Demo data created (admin@daji.test / Admin@12345 and others). Demo mode is ON.');
} else if (!hasAdmin()) {
  console.warn('WARNING: there is no super admin yet. Create one with: node scripts/create-admin.ts');
}

registerProvider('push', expoPushProvider(cfg));
registerProvider('email', gmailProvider(cfg));
setOtpSender(whatsappOtpSender(cfg));
setOtpSmsSender(msg91OtpSender(cfg));
const server = buildServer(cfg);
startScheduler(cfg, (e) => console.error(JSON.stringify({ level: 'error', where: 'sweep', error: String((e as Error)?.stack ?? e) })));
server.listen(cfg.port, cfg.host, () => console.log(`Daji Cricket Ground API listening on ${cfg.host}:${cfg.port} (${cfg.publicUrl})`));

async function shutdown(sig: string): Promise<void> {
  console.log(`${sig}: shutting down`);
  stopScheduler();
  server.close();
  await flushNotifications();
  closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
