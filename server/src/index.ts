import { loadConfig, configWarnings, fatalConfigProblems } from './config.ts';
import { openDb, closeDb } from './db.ts';
import { buildServer } from './app.ts';
import { backfillThumbs, setLibraryRoot } from './library.ts';
import { seedDemo, hasAdmin } from './seed.ts';
import { startScheduler, stopScheduler } from './jobs.ts';
import { flushNotifications, registerProvider, setAlertSender, setOtpSender, setOtpSmsSender } from './notifications.ts';
import { expoPushProvider } from './push.ts';
import { whatsappOtpSender, whatsappAlertSender, msg91OtpSender } from './whatsapp.ts';
import { gmailProvider } from './gmail.ts';
import { applyYodleeSettings } from './yodleeSettings.ts';

const cfg = loadConfig();
const fatal = fatalConfigProblems(cfg);
if (fatal.length) {
  for (const f of fatal) console.error(`FATAL: ${f}`);
  console.error('The server will not start with this configuration.');
  process.exit(1);
}
openDb(cfg.dbPath);
applyYodleeSettings(cfg);
for (const w of configWarnings(cfg)) console.warn(`WARNING: ${w}`);
if (cfg.demoMode && !cfg.isLocal) {
  const line = '!'.repeat(78);
  console.warn(`${line}\n!! DEMO MODE IS ON for ${cfg.publicUrl}: demo logins work and payments are fake.\n!! Set DEMO_MODE=off in deploy/.env and restart before taking real bookings.\n${line}`);
}
if (cfg.demoMode) {
  const r = seedDemo(cfg);
  if (r.created) console.log('Demo data created (admin@daji.test / Admin@12345 and others). Demo mode is ON.');
} else if (!hasAdmin()) {
  console.warn('WARNING: there is no super admin yet. Create one with: node scripts/create-admin.ts');
}

registerProvider('push', expoPushProvider(cfg));
registerProvider('email', gmailProvider(cfg));
setOtpSender(whatsappOtpSender(cfg));
setAlertSender(whatsappAlertSender(cfg));
setOtpSmsSender(msg91OtpSender(cfg));
const server = buildServer(cfg);
startScheduler(cfg, (e) => console.error(JSON.stringify({ level: 'error', where: 'sweep', error: String((e as Error)?.stack ?? e) })));
// Node closes any request that takes longer than 5 minutes to arrive, which cuts off big photo and video uploads on a slow connection.
server.requestTimeout = 2 * 60 * 60 * 1000;
setLibraryRoot(cfg.dataDir);
setTimeout(() => backfillThumbs(cfg.dataDir), 20_000);
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
