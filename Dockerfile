# ═══════════════════════════════════════════════════════════════
# SnapSave Pro Backend - Production Dockerfile
# Node.js 18 with Python, FFmpeg, and yt-dlp
# ═══════════════════════════════════════════════════════════════

FROM node:18-slim

# Prevent interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# ═══════════════════════════════════════════════════════════════
# SYSTEM DEPENDENCIES
# Install Python 3, FFmpeg, curl, and CA certificates
# ═══════════════════════════════════════════════════════════════

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    wget \
    xz-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# ═══════════════════════════════════════════════════════════════
# INSTALL YT-DLP (Latest Binary)
# Using official binary for maximum compatibility and performance
# ═══════════════════════════════════════════════════════════════

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && ln -s /usr/local/bin/yt-dlp /usr/bin/yt-dlp

# Verify installations
RUN echo "=== Verifying installations ===" \
    && node --version \
    && python3 --version \
    && ffmpeg -version | head -n 1 \
    && yt-dlp --version \
    && echo "=== All dependencies verified ==="

# ═══════════════════════════════════════════════════════════════
# APPLICATION SETUP
# ═══════════════════════════════════════════════════════════════

# Copy package files first (leverage Docker cache)
COPY package*.json ./

# Install Node.js dependencies (FIXED: use npm install instead of npm ci)
RUN npm install --production && npm cache clean --force

# Copy application source
COPY . .

# Create downloads directory with proper permissions
RUN mkdir -p /tmp/downloads && chmod 777 /tmp/downloads

# ═══════════════════════════════════════════════════════════════
# SECURITY & PERFORMANCE
# ═══════════════════════════════════════════════════════════════

# Create non-root user for security
RUN groupadd -r snapsave && useradd -r -g snapsave -s /bin/false snapsave \
    && chown -R snapsave:snapsave /app /tmp/downloads

# Switch to non-root user
USER snapsave

# Expose port (Render sets PORT env var, default 10000)
EXPOSE 10000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:10000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start the application
CMD ["node", "index.js"]
