# ========================================
# Stage 1: Base
# ========================================
FROM node:20-bullseye-slim AS base

# Install OpenSSL and other required dependencies
RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# ========================================
# Stage 2: Dependencies
# ========================================
FROM base AS dependencies

# Install ALL dependencies (including devDependencies)
RUN npm ci

# ========================================
# Stage 3: Build
# ========================================
FROM dependencies AS build

# Install NestJS CLI globally for build stage
RUN npm install -g @nestjs/cli

# Set placeholder DATABASE_URL for Prisma generate (required at build time)
# The real DATABASE_URL will be loaded from .env.* files at runtime via dotenvx
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=aura"

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# ========================================
# Stage 4: Development
# ========================================
FROM dependencies AS development

# Set placeholder DATABASE_URL for Prisma generate (required at build time)
# The real DATABASE_URL will be loaded from .env.development at runtime via dotenvx
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=aura"

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Copy encrypted environment file (will be decrypted using DOTENV_PRIVATE_KEY_DEVELOPMENT)
COPY .env.development ./

# Expose port
EXPOSE 5000

# Start development server with hot-reload
CMD ["npm", "run", "start:dev"]

# ========================================
# Stage 5: Production
# ========================================
FROM node:20-alpine AS production

# Install OpenSSL (required by Prisma)
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Install dotenvx globally for production runtime
RUN npm install -g @dotenvx/dotenvx

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma schema and migrations for runtime
COPY --from=build /app/prisma ./prisma

# Copy encrypted environment files (will be decrypted using DOTENV_PRIVATE_KEY_PRODUCTION)
COPY .env.production ./

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start production server with dotenvx (run migrations first, then start app)
CMD ["sh", "-c", "dotenvx run --env-file=.env.production -- sh -c 'npx prisma migrate deploy && node dist/main.js'"]
