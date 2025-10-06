FROM mcr.microsoft.com/playwright:v1.47.2-jammy AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.47.2-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY src/templates ./src/templates
ENV PORT=4001
ENV HOST=0.0.0.0
EXPOSE 4001
CMD ["node", "dist/index.js"]
