FROM node:22-alpine AS web-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1.98-alpine AS api-build
RUN apk add --no-cache musl-dev
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA
RUN cargo build --locked --release

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates && addgroup -S router && adduser -S -G router -h /app router
WORKDIR /app
COPY --from=api-build /build/target/release/service-notification-router /usr/local/bin/service-notification-router
COPY --from=web-build /build/frontend/dist ./frontend/dist
RUN mkdir -p /data && chown -R router:router /data /app
USER router
ENV PORT=8080 DATA_DIR=/data RUST_LOG=service_notification_router=info,tower_http=info
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/usr/local/bin/service-notification-router"]
