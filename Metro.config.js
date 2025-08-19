// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Disable source maps for release builds to avoid this error
config.serializer = {
  ...config.serializer,
  createModuleIdFactory: function () {
    return function (path) {
      // Use path-based stable IDs
      return path.substr(1).replace(/[^a-zA-Z0-9$_]/g, '_');
    };
  },
};

// Disable source maps in release mode
if (process.env.NODE_ENV === 'production') {
  config.serializer.createModuleIdFactory = () => () => '';
}

module.exports = config;
