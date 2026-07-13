# Standalone deploy for the connector-service ONLY — this image is not the
# Next.js app. Build/run from the repo root so it can reach ../src and
# ../prisma:
#
#   docker build -f connector-service/Dockerfile -t tdis-connector-service .
#   docker run --env-file connector-service/.env -p 4100:4100 tdis-connector-service

FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS base
# Official Playwright image — Chromium + all OS-level deps for headless
# Chromium already installed, so we skip `playwright install` at runtime.

WORKDIR /app

# Copy just the two package.jsons first for better layer caching.
COPY connector-service/package.json connector-service/package-lock.json* ./connector-service/
COPY package.json ./package.json

RUN cd connector-service && npm install
# npm's tarball extraction doesn't always preserve the executable bit on
# installed CLI binaries inside Docker's build environment — this is the
# actual cause of "prisma: Permission denied" (exit 126), separate from
# the node_modules-in-git issue fixed earlier. Restoring it explicitly here
# also covers `tsc` (used two steps down in `npm run build`), which would
# otherwise hit the exact same error right after this one gets fixed.
RUN chmod -R +x connector-service/node_modules/.bin

# THE ACTUAL FIX for "Cannot find module 'firebase-admin'/'@prisma/client'":
# packages only get installed into /app/connector-service/node_modules (npm
# install ran inside that folder), but the shared framework module lives at
# /app/src/modules/airline-connectors — a SIBLING of connector-service, not
# a descendant. Node's module resolution only walks UPWARD from the
# importing file's own directory looking for a node_modules folder, so it
# can never find connector-service's node_modules from a file under
# /app/src/... no matter what tsconfig moduleResolution setting is used.
# Symlinking /app/node_modules -> connector-service's makes every installed
# package visible from anywhere under /app, including the shared module.
RUN ln -s /app/connector-service/node_modules /app/node_modules

# Now copy the actual source: the connector-service itself, the shared
# framework module it imports via relative paths, and the Prisma schema.
COPY connector-service ./connector-service
COPY src/modules/airline-connectors ./src/modules/airline-connectors
COPY prisma ./prisma

RUN cd connector-service && npx prisma generate --schema=../prisma/schema.prisma
RUN cd connector-service && npm run build

WORKDIR /app/connector-service
EXPOSE 4100
CMD ["node", "dist/connector-service/src/server.js"]
