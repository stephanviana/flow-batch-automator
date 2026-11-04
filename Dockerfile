FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
WORKDIR /app
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/orchestrator/package.json packages/orchestrator/package.json
COPY packages/extension/package.json packages/extension/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY agents ./agents
COPY skills ./skills
RUN pnpm build
RUN pnpm --filter @flow-batch/orchestrator deploy --prod /release

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS sync-extension
WORKDIR /app
COPY --from=build /app/packages/extension/dist /extension
COPY scripts/sync-extension.mjs /app/sync-extension.mjs
USER node
ENTRYPOINT ["node", "/app/sync-extension.mjs"]

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS orchestrator
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4319 DATABASE_PATH=/data/flow-batch.sqlite
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /release/ /app/
COPY scripts/healthcheck.mjs /app/healthcheck.mjs
USER node
EXPOSE 4319
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "dist/main.js"]
