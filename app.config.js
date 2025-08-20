export default ({ config }) => ({
  ...config,
  name: 'Trafficlites',
  slug: 'trafficlites-app',
  version: '1.0.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.zinngar.trafficlites',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'This app uses your location to show your position on the map and help report traffic light statuses nearby.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    package: 'com.zinngar.trafficlites',
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Allow $(PRODUCT_NAME) to use your location.',
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '0bc0887b-6e2d-440c-a112-d5cd938f0aa1',
    },
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  },
  owner: 'zinngar',
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: 'https://u.expo.dev/0bc0887b-6e2d-440c-a112-d5cd938f0aa1',
    enabled: true,
    fallbackToCacheTimeout: 0,
  },
});
