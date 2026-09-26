FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3847
ENV ELTORRENTO_DB=/app/data/app.sqlite
CMD ["npm", "start"]
