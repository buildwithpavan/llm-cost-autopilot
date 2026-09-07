# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY packages ./packages
RUN --mount=type=cache,target=/root/.npm npm ci
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/packages ./packages
COPY --from=builder /workspace/package.json ./package.json
USER 65532:65532
EXPOSE 8080
CMD ["packages/api/dist/index.js"]
