// Loads the same modules, in the same order, as the server does at start (src/index.ts), so every schema module is registered before a tool opens a database.
// A tool that opens a database without this would see only some of the modules and could migrate it differently from the server.
import '../src/config.ts';
import '../src/db.ts';
import '../src/app.ts';
import '../src/library.ts';
import '../src/seed.ts';
import '../src/jobs.ts';
import '../src/notifications.ts';
import '../src/push.ts';
import '../src/whatsapp.ts';
import '../src/gmail.ts';
import '../src/yodleeSettings.ts';
