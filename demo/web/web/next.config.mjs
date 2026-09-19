/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // This app lives inside the public reference repo, which has its own
  // lockfile. Without this, Next walks up and picks the wrong workspace root.
  outputFileTracingRoot: import.meta.dirname,
};
export default nextConfig;
