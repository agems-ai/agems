FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/ai/package.json packages/ai/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/adapters/package.json packages/adapters/
COPY packages/plugins/package.json packages/plugins/
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @agems/db generate
RUN pnpm --filter @agems/api build

FROM base AS runner
RUN apk add --no-cache ffmpeg git
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./

# Remove dev artifacts to reduce image size
RUN rm -rf apps/web apps/api/src apps/api/test \
    packages/ai/src packages/shared/src \
    .git .github .vscode \
    **/*.ts.map **/*.spec.ts \
    apps/api/node_modules/@types \
    node_modules/@types node_modules/typescript \
    node_modules/webpack node_modules/ts-loader \
    2>/dev/null || true

WORKDIR /app/apps/api
COPY apps/api/entrypoint.sh /app/apps/api/entrypoint.sh
RUN chmod +x /app/apps/api/entrypoint.sh
EXPOSE 3001
CMD ["/app/apps/api/entrypoint.sh"]
