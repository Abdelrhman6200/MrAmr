# Debian slim ships time zone data, so the image needs no extra OS packages.

# --- build the web app -------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    TZ=Africa/Cairo
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
# The server reuses the UI translations for emails.
COPY client/src/i18n.js ./client/src/i18n.js
COPY --from=build /app/client/dist ./client/dist
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/data && chown -R node:node /app/data
# No USER here: the entrypoint fixes ownership of the mounted disk, then drops to `node`.
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.js"]
