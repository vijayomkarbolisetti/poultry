const identity = require("./src/config/app-identity.json");

/**
 * Spreads `app.json` then applies the centralized display name.
 * Does not touch `android.package`, EAS project IDs, or ownership.
 */
module.exports = ({ config }) => {
  const name = identity.name;
  const plugins = (config.plugins ?? []).map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === "expo-image-picker") {
      return [
        "expo-image-picker",
        {
          photosPermission: `Allow ${name} to attach photos from your library.`,
          cameraPermission: `Allow ${name} to take photos for farm records.`,
        },
      ];
    }
    return plugin;
  });

  return {
    ...config,
    name,
    plugins,
  };
};
