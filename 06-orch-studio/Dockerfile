# Orch Studio (E28) - one image for every company; the company configures it, it does not build one.
# Built from the root of Orchescala after `sbt orchDocClient/bundleDocClient` (the apps):
#   docker build -f 06-orch-studio/Dockerfile -t orch-studio:local .
# Only what the studio needs goes into the build (Dockerfile.dockerignore).
FROM node:22-alpine
WORKDIR /studio
ENV NODE_ENV=production
COPY 06-orch-studio/package.json 06-orch-studio/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY 06-orch-studio/src ./src
COPY 06-orch-studio/skills ./skills
# orch-doc, orch-spec and orch-ops - the version the studio is built with
COPY 04-orch-doc/bundle/orch-doc-site ./apps
# in the container on all addresses - the port is published to localhost by the stack (no login, PoC)
ENV STUDIO_HOST=0.0.0.0
EXPOSE 8880
USER node
CMD ["node", "src/main.ts"]
