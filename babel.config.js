
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        alias: {
          '../Utilities/Platform': 'react-native-web/dist/exports/Platform',
        },
      }],
    ],
  };
};
