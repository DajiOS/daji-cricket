import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
const M = '/home/claude/cricket-booking/mobile', Sh = process.cwd() + '/shim';
await build({
  entryPoints: [process.cwd() + '/entry.tsx'], bundle: true, outfile: process.cwd() + '/out/bundle.js', format: 'iife', jsx: 'automatic', loader: { '.ts': 'ts', '.tsx': 'tsx' },
  alias: { 'react-native': Sh + '/rn.tsx', 'expo-secure-store': Sh + '/stubs.ts', 'expo-image-picker': Sh + '/picker.ts', 'expo-notifications': Sh + '/notif.ts', 'expo-constants': Sh + '/misc.tsx', 'expo-status-bar': Sh + '/misc.tsx', 'react-native-webview': Sh + '/misc.tsx', react: '/opt/npm-tools/node_modules/react', 'react-dom': '/opt/npm-tools/node_modules/react-dom' },
  define: { 'process.env.EXPO_PUBLIC_API_URL': '"https://api.dajicricket.com"', 'process.env.NODE_ENV': '"production"' }, nodePaths: ['/opt/npm-tools/node_modules'], logLevel: 'error',
});
console.log('bundled');
