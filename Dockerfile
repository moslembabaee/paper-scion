FROM node:22-alpine AS builder
WORKDIR /build/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --prefer-offline
COPY app/ ./
RUN npm run build

FROM node:22-alpine AS api
RUN apk add --no-cache su-exec
WORKDIR /service
COPY app/server/package.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /build/app/server/dist ./dist
COPY app/server/entrypoint.sh ./entrypoint.sh
RUN mkdir /data && chown node:node /data
ENTRYPOINT ["sh", "/service/entrypoint.sh"]
EXPOSE 3001
CMD ["node", "dist/server/index.js"]

FROM nginx:1.27-alpine AS server
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx.conf /etc/nginx/conf.d/paper.conf
COPY --from=builder /build/app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
