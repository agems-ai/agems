const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');

module.exports = (options) => {
  return {
    ...options,
    resolve: {
      ...options.resolve,
      alias: {
        '@agems/shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@agems/ai': path.resolve(__dirname, '../../packages/ai/src'),
        '@agems/db': path.resolve(__dirname, '../../packages/db/src'),
      },
    },
    plugins: [
      ...(options.plugins || []),
      new webpack.IgnorePlugin({
        checkResource(resource) {
          const ignored = ['mock-aws-s3', 'aws-sdk', 'nock'];
          return ignored.includes(resource);
        },
      }),
    ],
    externals: [
      nodeExternals({
        allowlist: [/^@agems\//],
        modulesDir: path.resolve(__dirname, '../../node_modules'),
      }),
      nodeExternals({
        allowlist: [/^@agems\//],
        modulesDir: path.resolve(__dirname, 'node_modules'),
      }),
    ],
    module: {
      ...options.module,
      rules: [
        {
          test: /\.ts$/,
          use: {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              configFile: path.resolve(__dirname, 'tsconfig.json'),
            },
          },
          exclude: /node_modules\/(?!@agems)/,
        },
      ],
    },
  };
};
