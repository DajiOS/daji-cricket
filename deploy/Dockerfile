# Daji Cricket Ground: one image with the API and the website. No build step and no npm dependencies at run time.
FROM node:22.22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data WEB_DIR=/app/web/public PORT=4000 HOST=0.0.0.0
COPY package.json ./package.json
COPY shared ./shared
COPY server ./server
COPY web/public ./web/public
WORKDIR /app/server
# '@daji/shared' is a workspace package; there is no npm install here, so link it by hand.
RUN mkdir -p /app/server/node_modules/@daji && ln -s /app/shared /app/server/node_modules/@daji/shared
RUN useradd --system --uid 10001 daji && mkdir -p /data && chown daji /data
USER daji
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
