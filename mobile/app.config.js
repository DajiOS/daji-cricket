// One codebase, two apps. APP_VARIANT=customer (default) is the public booking app; APP_VARIANT=admin is the staff and owner app.
// `config` is the "expo" section of app.json.
module.exports = ({ config }) => {
  const admin = process.env.APP_VARIANT === 'admin';
  return {
    ...config,
    name: admin ? 'Daji Admin' : 'Daji Cricket Ground',
    scheme: admin ? 'dajiadmin' : 'dajicricket',
    ios: { ...config.ios, bundleIdentifier: admin ? 'com.dajicricket.admin' : 'com.dajicricket.app' },
    android: { ...config.android, package: admin ? 'com.dajicricket.admin' : 'com.dajicricket.app' },
    extra: { ...config.extra, variant: admin ? 'admin' : 'customer' },
  };
};
