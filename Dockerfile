FROM node:22-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/browsers HOST=0.0.0.0 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npx playwright install --with-deps chromium
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json vite.config.ts ./
RUN npm run build && mkdir -p /app/data && chown -R node:node /app /opt/browsers
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm","run","start:server"]
