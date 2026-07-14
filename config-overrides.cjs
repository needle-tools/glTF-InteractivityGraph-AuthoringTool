const importAttributesToAssertions = require.resolve(
    "@babel/plugin-proposal-import-attributes-to-assertions",
);
const webpack = require("webpack");

module.exports = function override(config) {
    addBabelPlugin(config.module?.rules, importAttributesToAssertions);
    config.resolve.alias = {
        ...config.resolve.alias,
        "needle-engine-runtime$": "@needle-tools/engine",
    };
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
    }));
    config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        module: false,
        path: false,
        process: false,
    };
    return config;
};

function addBabelPlugin(rules, plugin) {
    if (!Array.isArray(rules)) return;
    for (const rule of rules) {
        if (Array.isArray(rule.oneOf)) addBabelPlugin(rule.oneOf, plugin);
        if (typeof rule.loader !== "string" || !rule.loader.includes("babel-loader") || !rule.options) continue;
        rule.options.plugins = [...(rule.options.plugins ?? []), plugin];
    }
}
