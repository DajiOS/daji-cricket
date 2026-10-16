// One codebase, two apps. APP_VARIANT=customer (default) is the public booking app; APP_VARIANT=admin is the staff and owner app.
const base = require('./app.json').expo;
const admin = process.env.APP_VARIANT === 'admin';
module.exports = () => ({
  ...base,
  name: admin ? 'Daji Admin' : 'Daji Cricket Ground',
  scheme: admin ? 'dajiadmin' : 'dajicricket',
  ios: { ...base.ios, bundleIdentifier: admin ? 'com.dajicricket.admin' : 'com.dajicricket.app' },
  android: { ...base.android, package: admin ? 'com.dajicricket.admin' : 'com.dajicricket.app' },
  extra: { ...base.extra, variant: admin ? 'admin' : 'customer' },
});
