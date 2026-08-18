# Standalone deploy for whatsapp-service ONLY — unlike connector-service,
# this doesn't import any shared src/modules code (it only calls the main
# app's existing HTTP API), so the whole image is self-contained to this
# directory.
#
# When building from repo root (as Railway does):
#   docker build -f whatsapp-service/Dockerfile -t tdis-whatsapp-service .
# When building locally from whatsapp-service directory:
#   docker build -f Dockerfile -t tdis-whatsapp-service .
#   docker run --env-file .env -p 4200:4200 -v whatsapp_auth:/app/auth_info tdis-whatsapp-service

FROM node:24-slim AS base
WORKDIR /app

COPY whatsapp-service/package.json whatsapp-service/package-lock.json* ./
RUN npm install

COPY whatsapp-service ./
RUN npm run build

EXPOSE 4200
CMD ["node", "dist/index.js"]
