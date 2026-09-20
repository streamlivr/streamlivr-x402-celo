# Streamlivr x402 demo site (Next.js).
#
# Coolify builds this from the public repo with the base directory set to
# demo/web/web. Two properties of the app shape the file:
#
#   1. Every NEXT_PUBLIC_ value is compiled into the browser bundle, so the
#      values have to exist during `next build`, not only at runtime. Coolify
#      passes them when the variables are marked as build variables.
#   2. output:standalone keeps the runtime image clear of the build toolchain.
#      It is switched on with NEXT_OUTPUT_MODE so a local build and `npm start`
#      keep working exactly as the README describes.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Defaults keep a plain `docker build .` usable: it produces a Sepolia-pointed
# demo that can quote a price but holds no key to pay with.
ARG NEXT_PUBLIC_API_BASE_URL=https://api.streamlivr.com
ARG NEXT_PUBLIC_BURNER_PRIVATE_KEY=
ARG NEXT_PUBLIC_BURNER_LABEL=demo burner
ARG NEXT_PUBLIC_MAX_ATOMIC_PER_REQUEST=10000
ARG NEXT_PUBLIC_MAX_ATOMIC_PER_SESSION=200000
ARG NEXT_PUBLIC_ENABLE_MAINNET=false

ENV NEXT_OUTPUT_MODE=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_BURNER_PRIVATE_KEY=$NEXT_PUBLIC_BURNER_PRIVATE_KEY \
    NEXT_PUBLIC_BURNER_LABEL=$NEXT_PUBLIC_BURNER_LABEL \
    NEXT_PUBLIC_MAX_ATOMIC_PER_REQUEST=$NEXT_PUBLIC_MAX_ATOMIC_PER_REQUEST \
    NEXT_PUBLIC_MAX_ATOMIC_PER_SESSION=$NEXT_PUBLIC_MAX_ATOMIC_PER_SESSION \
    NEXT_PUBLIC_ENABLE_MAINNET=$NEXT_PUBLIC_ENABLE_MAINNET

RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3008 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs

# Standalone output plus the two folders Next does not trace: static assets and
# anything served from public/.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3008/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
