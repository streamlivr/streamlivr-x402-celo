/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // The container build sets NEXT_OUTPUT_MODE=standalone so the runtime image
  // carries only the traced server. Locally the option stays off, which keeps
  // `npm run build && npm start` working the way the README describes.
  output: process.env.NEXT_OUTPUT_MODE === 'standalone' ? 'standalone' : undefined,
  // This app lives inside the public reference repo, which has its own
  // lockfile. Without this, Next walks up and picks the wrong workspace root.
  outputFileTracingRoot: import.meta.dirname,
};
export default nextConfig;
