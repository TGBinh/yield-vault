# Simple full-context build: npm workspaces need the root lockfile plus every
# workspace's package.json to resolve consistently, so we copy the whole repo
# (see .dockerignore) rather than trying to cherry-pick just this workspace.
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
# --workspace scopes npm install to this workspace's own deps (skips frontend/contracts'
# unrelated, much larger dependency trees like Next.js/Hardhat) - cuts build time drastically.
RUN npm install --workspace=backend
# npm workspaces hoist deps to the root node_modules when possible - whether a
# workspace-local node_modules/ actually gets created depends on the specific
# dependency tree shape, so guarantee it exists (even empty) before the COPY below,
# otherwise the build fails with "not found" on environments where everything hoisted.
RUN mkdir -p backend/node_modules
RUN npm run build --workspace=backend

FROM node:20-alpine
WORKDIR /app
# Vault Security Audit - High: chạy bằng root nghĩa là RCE/path-traversal trong backend
# (nhận input từ chain + HTTP) cho attacker quyền root trong container. node:20-alpine
# đã có sẵn user "node" (uid 1000) - chỉ cần chown đúng lúc copy.
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/backend/node_modules backend/node_modules
COPY --from=build --chown=node:node /app/backend/dist backend/dist
COPY --from=build --chown=node:node /app/backend/package.json backend/package.json
WORKDIR /app/backend
USER node
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
