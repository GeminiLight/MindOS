const { withAndroidManifest } = require('expo/config-plugins');

/** Local MindOS servers use user-entered LAN IPs, which cannot be enumerated as domains at build time. */
module.exports = function withLocalNetwork(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (application) application.$['android:usesCleartextTraffic'] = 'true';
    return config;
  });
};
