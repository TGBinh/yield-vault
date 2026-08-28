# Simple full-context build: npm workspaces need the root lockfile plus every
# workspace's package.json to resolve consistently, so we copy the whole repo
# (see .dockerignore) rather than trying to cherry-pick just this workspace.
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
# --workspace scopes npm install to this workspace's own deps (skips frontend/contracts'
# unrelated, much larger dependency trees like Next.js/Hardhat) - cuts build time drastically.
RUN npm install --workspace=indexer
# npm workspaces hoist deps to the root node_modules when possible - whether a
# workspace-local node_modules/ actually gets created depends on the specific
# dependency tree shape, so guarantee it exists (even empty) before the COPY below,
# otherwise the build fails with "not found" on environments where everything hoisted.
RUN mkdir -p indexer/node_modules
RUN npm run build --workspace=indexer

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/indexer/node_modules indexer/node_modules
COPY --from=build /app/indexer/dist indexer/dist
COPY --from=build /app/indexer/package.json indexer/package.json
WORKDIR /app/indexer
EXPOSE 9464
CMD ["node", "dist/index.js"]
