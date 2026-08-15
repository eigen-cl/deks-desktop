FROM node:22-bookworm-slim AS web
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM rust:1.89-trixie AS rust-test
WORKDIR /workspace/src-tauri
COPY src-tauri/Cargo.toml src-tauri/build.rs ./
COPY src-tauri/src ./src
COPY src-tauri/tauri.conf.json ./
COPY src-tauri/capabilities ./capabilities
COPY package.json ../package.json
COPY index.html ../index.html
RUN mkdir -p ../dist && printf '<!doctype html><title>DEKS</title>' > ../dist/index.html

FROM rust-test AS rust
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential curl file libayatana-appindicator3-dev librsvg2-dev \
    libssl-dev libwebkit2gtk-4.1-dev libxdo-dev \
  && rm -rf /var/lib/apt/lists/*
