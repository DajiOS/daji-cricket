Hosted preview of the phone app: the real screens drawn with HTML through a small stand-in for React Native (shim/), with the website preview's mock server for data.
Build: run `node build.mjs` from this folder (needs esbuild, react and react-dom), copy `web/preview` build output `mock-api.js` next to the bundle, and open index.html.
Not a substitute for running the app in Expo on a device.
