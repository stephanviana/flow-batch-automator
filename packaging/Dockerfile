FROM __NODE_IMAGE__ AS dependencies
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json ./
COPY --chown=node:node runtime/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ && npm cache clean --force

FROM __NODE_IMAGE__ AS sync-extension
WORKDIR /app
COPY runtime/extension/ /extension/
COPY runtime/sync-extension.mjs /app/sync-extension.mjs
USER node
ENTRYPOINT ["node", "/app/sync-extension.mjs"]

FROM __NODE_IMAGE__ AS orchestrator
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4319 DATABASE_PATH=/data/flow-batch.sqlite
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=dependencies --chown=node:node /app/node_modules/ /app/node_modules/
COPY --chown=node:node package.json /app/package.json
COPY --chown=node:node runtime/package-lock.json /app/package-lock.json
COPY --chown=node:node dist/ /app/dist/
COPY runtime/healthcheck.mjs /app/healthcheck.mjs
USER node
EXPOSE 4319
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "dist/main.mjs"]
