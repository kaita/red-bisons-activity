FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

COPY package*.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

USER node

EXPOSE 8787

CMD ["node", "src/server.js"]
