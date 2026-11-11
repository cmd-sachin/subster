# syntax=docker/dockerfile:1

# ---- Build: install everything and compile the app ------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

# ---- Run: only the compiled server, as an unprivileged user -----------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    SUBSTER_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/.output ./.output
# Accounts and each person's data live here. Mount a volume so they outlive the container.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/auth/me >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
