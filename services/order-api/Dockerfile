FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
EXPOSE 3000
CMD ["npx", "tsx", "watch", "src/index.ts"]