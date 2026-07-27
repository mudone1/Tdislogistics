# Standalone deploy for whatsapp-service ONLY — unlike connector-service,
# this doesn't import any shared src/modules code (it only calls the main
# app's existing HTTP API), so the whole image is self-contained to this
# directory.
#
#   docker build -f whatsapp-service/Dockerfile -t tdis-whatsapp-service whatsapp-service
#   docker run --env-file whatsapp-service/.env -p 4200:4200 -v whatsapp_auth:/app/auth_info tdis-whatsapp-service

FROM node:20-slim AS base
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4200
CMD ["node", "dist/index.js"]
