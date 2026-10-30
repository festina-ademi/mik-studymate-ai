# StudyMate AI frontend. Build from the repository root: docker build -f frontend/Dockerfile frontend
# Only needed for a self-hosted/docker-compose deployment; a static host (Vercel, Netlify,
# Cloudflare Pages — see docs/DEPLOYMENT.md) builds straight from the repo and needs no Dockerfile.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -q -O- http://127.0.0.1/ >/dev/null || exit 1
