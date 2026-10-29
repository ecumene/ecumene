# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=reducto_npm_token,required=true \
    REDUCTO_NPM_TOKEN="$(cat /run/secrets/reducto_npm_token)" npm ci --ignore-scripts
RUN npm rebuild skia-canvas
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data
COPY --from=build --chown=node:node /app/package.json ./package.json
# tsx is the server runner, so the runtime keeps installed development tools.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
VOLUME ["/app/.data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
CMD ["npm", "start"]
