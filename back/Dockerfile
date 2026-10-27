# --- зависимости и исходники (общая база для тестов и сборки) ---
FROM node:24-alpine AS deps
WORKDIR /app
# ffmpeg/ffprobe — приведение видео к H.264/AAC для iOS/macOS (нужен и тестам видео)
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# --- тесты: docker compose --profile test run --rm back-test ---
FROM deps AS test
CMD ["sh", "-c", "npm test && npm run test:e2e"]

# --- сборка ---
FROM deps AS build
RUN npm run build && npm prune --omit=dev

# --- рантайм (цель по умолчанию) ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/captcha').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]
