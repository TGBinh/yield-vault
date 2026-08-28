# Simple full-context build: npm workspaces need the root lockfile plus every
# workspace's package.json to resolve consistently, so we copy the whole repo
# (see .dockerignore) rather than trying to cherry-pick just this workspace.
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
# --workspace scopes npm install to this workspace's own deps (skips frontend/contracts'
# unrelated, much larger dependency trees like Next.js/Hardhat) - cuts build time drastically.
RUN npm install --workspace=backend
RUN npm run build --workspace=backend

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/package.json backend/package.json
WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/main.js"]
