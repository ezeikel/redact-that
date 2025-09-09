import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import withVercelToolbar from '@vercel/toolbar/plugins/next';

const nextConfig: NextConfig = {
  experimental: {},
};

// sentry configuration options
const sentryOptions = {
  silent: true,
  org: 'chewybytes',
  project: 'redact-that-web',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  transpileClientSDK: true,
  tunnelRoute: true,
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
  reactComponentAnnotation: {
    enabled: true,
  },
};

const configWithSentry = withSentryConfig(nextConfig, sentryOptions);

const configWithVercelToolbar = withVercelToolbar()(configWithSentry);

export default configWithVercelToolbar;
