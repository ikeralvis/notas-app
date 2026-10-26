# Imagen OCI estándar: sirve igual con Docker y con Podman.
FROM docker.io/library/node:24-slim AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM docker.io/library/node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data BACKUP_DIR=/backups NODE_NO_WARNINGS=1
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /web/dist ./public
EXPOSE 3000
CMD ["node", "src/index.ts"]
