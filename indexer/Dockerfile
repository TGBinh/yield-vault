# Simple full-context build: npm workspaces need the root lockfile plus every
# workspace's package.json to resolve consistently, so we copy the whole repo
# (see .dockerignore) rather than trying to cherry-pick just this workspace.
# Pin theo digest (không chỉ tag "20-alpine") để build không bị âm thầm đổi base image
# khi Docker Hub tag lại "20-alpine" trỏ tới bản khác - digest lấy thật qua
# `docker pull node:20-alpine && docker inspect --format='{{index .RepoDigests 0}}'`.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
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

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
WORKDIR /app
# Vault Security Audit - High: node:20-alpine đã có sẵn user "node" (uid 1000) - chạy
# bằng root không cần thiết nếu chỉ cần chown đúng lúc copy.
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/indexer/node_modules indexer/node_modules
COPY --from=build --chown=node:node /app/indexer/dist indexer/dist
COPY --from=build --chown=node:node /app/indexer/package.json indexer/package.json
WORKDIR /app/indexer
USER node
ENV NODE_ENV=production
EXPOSE 9464
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:9464/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
