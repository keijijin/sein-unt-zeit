# Build context: repository root (needs doc/, scripts/, web/).
FROM docker.io/library/node:22-alpine AS build
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
COPY scripts ./scripts
COPY doc ./doc
COPY web ./web
WORKDIR /src/web
RUN npm ci && npm run build

FROM docker.io/nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx-default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/web/dist /usr/share/nginx/html
EXPOSE 8080
