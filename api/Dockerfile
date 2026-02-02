FROM node:18-alpine

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (include dev dependencies for nodemon)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs && chown -R node:node /app

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Start application with nodemon for hot reload
CMD ["npx", "nodemon", "src/server.js"]
