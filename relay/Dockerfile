FROM node:22-slim AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/main.js"]
