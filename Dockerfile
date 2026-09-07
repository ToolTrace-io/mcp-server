# Build stage: compile TypeScript to dist/
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Shared runtime: production dependencies and compiled output, no entry point.
# Both transports are the same code; only the process they start differs.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node

# Remote target: Streamable HTTP on /mcp, one process serving many callers who
# each present their own ToolTrace key as a bearer token. Build with:
#   docker build --target http .
FROM runtime AS http
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/http.js"]

# Default target, kept last deliberately so a plain `docker build .` still
# produces the stdio server it always has. The API key comes from the host.
FROM runtime AS stdio
ENTRYPOINT ["node", "dist/index.js"]
