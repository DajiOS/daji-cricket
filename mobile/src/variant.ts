import Constants from 'expo-constants';
// Which of the two apps this build is. Set by app.config.js from APP_VARIANT.
export const ADMIN_APP = (Constants.expoConfig?.extra as { variant?: string } | undefined)?.variant === 'admin';
