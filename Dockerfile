# Every dependency is pure JavaScript now, so there is no native addon to build
# and no compiler toolchain to install.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# Bind all interfaces: 127.0.0.1 inside a container is unreachable from the
# Docker network, so the reverse proxy could never connect.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY views ./views
COPY locales ./locales
COPY public ./public
COPY scripts ./scripts

# Bundle the stylesheet and render the social/icon PNGs at build time so the
# container never writes to its own image layer on boot.
RUN node scripts/build-css.mjs && node scripts/build-og.mjs

# Nothing is written at runtime: leads leave over the Mailgun API, so the
# container is disposable and needs no volume.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:3000/ar').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
