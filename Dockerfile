# --- build the web app -------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    TZ=Africa/Cairo
RUN apk add --no-cache tzdata
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.js"]
