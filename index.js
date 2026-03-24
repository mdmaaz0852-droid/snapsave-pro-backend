/**
 * ═════════════════════════════════════════════════════════════════
 * SnapSave Pro Backend - High-Performance Video Analysis API
 * Powered by yt-dlp | Optimized for luxurious user experience
 * ═════════════════════════════════════════════════════════════════
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;

// Promisify exec for async/await
const execAsync = promisify(exec);

// ═════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═════════════════════════════════════════════════════════════════

const CONFIG = {
    PORT: process.env.PORT || 10000,
    NODE_ENV: process.env.NODE_ENV || 'production',
    RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutes
    RATE_LIMIT_MAX: 50, // requests per window
    REQUEST_TIMEOUT: 45000, // 45 seconds
    MAX_BUFFER: 10 * 1024 * 1024, // 10MB buffer for JSON
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',') || ['*']
};

// ═════════════════════════════════════════════════════════════════
// EXPRESS APP INITIALIZATION
// ═════════════════════════════════════════════════════════════════

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS - Configure for Android app access
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        
        if (CONFIG.ALLOWED_ORIGINS[0] === '*' || CONFIG.ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400
}));

// Compression for faster responses
app.use(compression({
    level: 6,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// ═════════════════════════════════════════════════════════════════
// RATE LIMITING - Prevent abuse
// ═════════════════════════════════════════════════════════════════

const limiter = rateLimit({
    windowMs: CONFIG.RATE_LIMIT_WINDOW,
    max: CONFIG.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please slow down.',
        retry_after: Math.ceil(CONFIG.RATE_LIMIT_WINDOW / 1000)
    }
});

app.use('/analyze', limiter);

// ═════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═════════════════════════════════════════════════════════════════

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
    next();
});

// Request timeout handling
app.use((req, res, next) => {
    req.setTimeout(CONFIG.REQUEST_TIMEOUT, () => {
        res.status(408).json({
            success: false,
            error: 'Request timeout. Please try again.'
        });
    });
    next();
});

// ═════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════

/**
 * Health Check Endpoint
 * Required for Render.com and load balancers
 */
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: CONFIG.NODE_ENV,
        version: process.env.npm_package_version || '2.0.0'
    });
});

/**
 * Root Endpoint - API Information
 */
app.get('/', (req, res) => {
    res.json({
        success: true,
        name: 'SnapSave Pro API',
        version: '2.0.0',
        description: 'High-performance video analysis powered by yt-dlp',
        endpoints: {
            health: '/health',
            analyze: '/analyze?url={VIDEO_URL}'
        },
        supported_platforms: [
            'YouTube', 'Instagram', 'TikTok', 'Facebook', 
            'Twitter/X', 'Reddit', 'Vimeo', 'Dailymotion'
        ]
    });
});

/**
 * Video Analysis Endpoint
 * GET /analyze?url={VIDEO_URL}
 */
app.get('/analyze', async (req, res) => {
    const startTime = Date.now();
    const { url } = req.query;

    // ─────────────────────────────────────────────────────────────
    // INPUT VALIDATION
    // ─────────────────────────────────────────────────────────────

    if (!url) {
        return res.status(400).json({
            success: false,
            error: 'Missing required parameter: url',
            example: '/analyze?url=https://www.youtube.com/watch?v=...'
        });
    }

    // Validate URL format
    let validatedUrl;
    try {
        validatedUrl = new URL(url);
        if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
            throw new Error('Invalid protocol');
        }
    } catch (err) {
        return res.status(400).json({
            success: false,
            error: 'Invalid URL format. Please provide a valid HTTP/HTTPS URL.'
        });
    }

    console.log(`[ANALYZE] Processing: ${url}`);

    try {
        // ─────────────────────────────────────────────────────────
        // EXECUTE YT-DLP
        // ─────────────────────────────────────────────────────────

        const ytDlpCommand = `yt-dlp -j --no-warnings --no-download "${url}"`;
        
        const { stdout, stderr } = await execAsync(ytDlpCommand, {
            timeout: CONFIG.REQUEST_TIMEOUT,
            maxBuffer: CONFIG.MAX_BUFFER,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1'
            }
        });

        if (stderr && stderr.includes('ERROR')) {
            throw new Error(stderr);
        }

        if (!stdout) {
            throw new Error('No data received from video source');
        }

        // Parse yt-dlp JSON output
        const videoData = JSON.parse(stdout);

        // ─────────────────────────────────────────────────────────
        // FORMAT PROCESSING
        // ─────────────────────────────────────────────────────────

        const processedFormats = processFormats(videoData.formats, url);

        // ─────────────────────────────────────────────────────────
        // BUILD RESPONSE
        // ─────────────────────────────────────────────────────────

        const response = {
            success: true,
            data: {
                id: videoData.id,
                title: videoData.title || 'Untitled',
                description: videoData.description?.substring(0, 500) || null,
                thumbnail: videoData.thumbnail,
                duration: formatDuration(videoData.duration),
                duration_seconds: videoData.duration,
                
                uploader: {
                    name: videoData.uploader || videoData.channel || 'Unknown',
                    url: videoData.uploader_url || null,
                    id: videoData.channel_id || null
                },
                
                source: {
                    platform: videoData.extractor?.replace('IE', '') || 'Unknown',
                    url: videoData.webpage_url || url,
                    original_url: url
                },
                
                stats: {
                    views: videoData.view_count || null,
                    likes: videoData.like_count || null,
                    upload_date: videoData.upload_date || null
                },
                
                formats: processedFormats,
                total_formats: processedFormats.length
            },
            meta: {
                processed_at: new Date().toISOString(),
                response_time_ms: Date.now() - startTime,
                cached: false
            }
        };

        console.log(`[ANALYZE] Success: "${videoData.title}" | ${processedFormats.length} formats | ${Date.now() - startTime}ms`);
        
        res.json(response);

    } catch (error) {
        handleError(error, res, url);
    }
});

// ═════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════

function processFormats(formats, originalUrl) {
    if (!Array.isArray(formats)) return [];

    const videoFormats = formats
        .filter(format => {
            if (format.vcodec === 'none' || !format.vcodec) return false;
            if (!format.resolution || format.resolution === 'audio only') return false;
            if (format.format_note?.includes('storyboard')) return false;
            
            return true;
        })
        .map(format => {
            const height = format.height || 0;
            const width = format.width || 0;
            
            let qualityLabel = format.quality_label || format.format_note || '';
            if (!qualityLabel && height) {
                qualityLabel = height >= 2160 ? '4K' :
                              height >= 1440 ? '2K' :
                              height >= 1080 ? '1080p' :
                              height >= 720 ? '720p' :
                              height >= 480 ? '480p' : `${height}p`;
            }

            const filesize = format.filesize || format.filesize_approx;
            const sizeFormatted = formatFileSize(filesize);

            const downloadUrl = `/download?url=${encodeURIComponent(originalUrl)}&format=${format.format_id}`;

            return {
                format_id: format.format_id,
                quality: {
                    label: qualityLabel,
                    resolution: format.resolution,
                    height: height,
                    width: width,
                    fps: format.fps || 30
                },
                file: {
                    extension: format.ext || 'mp4',
                    size: {
                        bytes: filesize,
                        formatted: sizeFormatted
                    }
                },
                codec: {
                    video: format.vcodec?.split('.')[0] || 'unknown',
                    audio: format.acodec !== 'none' ? format.acodec?.split('.')[0] : null
                },
                urls: {
                    direct: downloadUrl,
                    manifest: format.manifest_url || null
                },
                is_premium: height >= 1440
            };
        })
        .filter((format, index, self) => 
            index === self.findIndex(f => f.quality.height === format.quality.height)
        )
        .sort((a, b) => b.quality.height - a.quality.height)
        .slice(0, 8);

    const audioFormat = formats.find(f => 
        f.acodec !== 'none' && 
        f.vcodec === 'none' &&
        f.abr
    );

    if (audioFormat) {
        videoFormats.push({
            format_id: audioFormat.format_id,
            quality: {
                label: 'Audio Only',
                resolution: 'audio',
                height: 0,
                width: 0,
                fps: 0
            },
            file: {
                extension: audioFormat.ext || 'm4a',
                size: {
                    bytes: audioFormat.filesize,
                    formatted: formatFileSize(audioFormat.filesize)
                }
            },
            codec: {
                video: null,
                audio: audioFormat.acodec?.split('.')[0] || 'aac'
            },
            urls: {
                direct: `/download?url=${encodeURIComponent(originalUrl)}&format=${audioFormat.format_id}`,
                manifest: null
            },
            is_premium: false
        });
    }

    return videoFormats;
}

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return null;
    
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return 'Unknown';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function handleError(error, res, url) {
    console.error(`[ERROR] URL: ${url} | Message: ${error.message}`);
    
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    let errorCode = 'UNKNOWN_ERROR';

    if (error.message.includes('Unsupported URL')) {
        statusCode = 400;
        errorMessage = 'This URL is not supported. Try YouTube, Instagram, TikTok, Facebook, Twitter, etc.';
        errorCode = 'UNSUPPORTED_URL';
    } else if (error.message.includes('Video unavailable')) {
        statusCode = 404;
        errorMessage = 'Video not found. It may be private, deleted, or region-restricted.';
        errorCode = 'VIDEO_UNAVAILABLE';
    } else if (error.message.includes('Sign in to confirm')) {
        statusCode = 403;
        errorMessage = 'This video requires authentication or age verification.';
        errorCode = 'AUTH_REQUIRED';
    } else if (error.message.includes('timeout')) {
        statusCode = 504;
        errorMessage = 'Request timed out. The video source may be slow.';
        errorCode = 'TIMEOUT';
    } else if (error.message.includes('JSON')) {
        statusCode = 502;
        errorMessage = 'Failed to parse video data. Please try again.';
        errorCode = 'PARSE_ERROR';
    }

    res.status(statusCode).json({
        success: false,
        error: errorMessage,
        code: errorCode,
        meta: {
            timestamp: new Date().toISOString(),
            requested_url: url,
            ...(CONFIG.NODE_ENV === 'development' && { stack: error.stack })
        }
    });
}

// ═════════════════════════════════════════════════════════════════
// ERROR HANDLING MIDDLEWARE
// ═════════════════════════════════════════════════════════════════

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        available_endpoints: ['/health', '/analyze?url=']
    });
});

app.use((err, req, res, next) => {
    console.error('[GLOBAL ERROR]', err);
    res.status(500).json({
        success: false,
        error: 'Unexpected server error',
        code: 'INTERNAL_ERROR'
    });
});

// ═════════════════════════════════════════════════════════════════
// SERVER STARTUP
// ═════════════════════════════════════════════════════════════════

app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║           🎬  SnapSave Pro Backend v2.0.0                       ║
║                                                                  ║
║   Status:      🟢  ONLINE                                        ║
║   Port:        ${CONFIG.PORT}                                          ║
║   Environment: ${CONFIG.NODE_ENV}                                  ║
║                                                                  ║
║   Endpoints:                                                     ║
║   • GET /health      → Health check                             ║
║   • GET /analyze     → Video analysis                           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[SHUTDOWN] SIGTERM received. Closing server gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[SHUTDOWN] SIGINT received. Closing server gracefully...');
    process.exit(0);
});
        
