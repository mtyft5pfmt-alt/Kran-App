FROM node:24-alpine
WORKDIR /app
COPY server/server.js server/server.js
COPY index.html manifest.json sw.js ./
COPY icons icons
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
