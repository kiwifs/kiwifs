# syntax=docker/dockerfile:1

# Stage 1: Build the web UI on the build host (arch-independent output).
FROM --platform=$BUILDPLATFORM node:22-alpine AS ui

WORKDIR /ui
COPY ui/package.json ui/package-lock.json* ui/.npmrc* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --loglevel=error
COPY ui ./
ENV NODE_OPTIONS=--max-old-space-size=3072
RUN npm run build

# Stage 2: Cross-compile Go binary on the build host for the target arch.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

ARG TARGETARCH

RUN apk add --no-cache git

WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN rm -rf ui/dist
COPY --from=ui /ui/dist ./ui/dist
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -ldflags="-s -w" -o /kiwifs .

# Stage 3: Runtime dependencies (builds in parallel with stages 1 & 2).
FROM alpine:3.20 AS runtime

RUN apk add --no-cache git ca-certificates docker-cli \
    pandoc \
    nodejs npm \
    python3 py3-pip \
    chromium \
    && addgroup -S kiwi && adduser -S kiwi -G kiwi

RUN --mount=type=cache,target=/root/.npm \
    npm install -g @marp-team/marp-cli --no-audit --no-fund 2>/dev/null || true

RUN --mount=type=cache,target=/root/.cache/pip \
    pip3 install --break-system-packages --no-cache-dir \
    mkdocs mkdocs-material 2>/dev/null || true

ENV CHROME_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Stage 4: Final assembly — only adds the compiled binary to the runtime.
FROM runtime

COPY --from=builder /kiwifs /usr/local/bin/kiwifs

RUN mkdir -p /data && chown kiwi:kiwi /data

USER kiwi

EXPOSE 3333

VOLUME ["/data"]

ENTRYPOINT ["kiwifs"]
CMD ["serve", "--root", "/data", "--port", "3333", "--host", "0.0.0.0", "--search", "sqlite"]
