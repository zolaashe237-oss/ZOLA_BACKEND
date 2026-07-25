FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Réseau instable : on durcit npm (retries) et on installe depuis le lockfile.
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
