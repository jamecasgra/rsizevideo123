const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const nodemailer = require("nodemailer");
const axios = require("axios");
const mcache = require("memory-cache");
require("dotenv").config();

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const processingApp = express();
const downloadApp = express();

const processingPort = process.env.PROCESSING_PORT || 5000;
const downloadPort = process.env.DOWNLOAD_PORT || 5001;
const API_KEY = process.env.API_KEY;

// Zoho Mail API credentials
const ZOHO_CLIENT_ID = "1000.E4IA2ECN1DTRFM46CVZ1HBP1DUQAOR";
const ZOHO_CLIENT_SECRET = "7e900273f9df429ee0db62c1e0690b1df447621937";
const ZOHO_MAIL_FROM = "mail@rsizevideo.com";

// Cache middleware
const cache = (duration) => {
  return (req, res, next) => {
    const key = '__express__' + req.originalUrl || req.url;
    const cachedBody = mcache.get(key);
    if (cachedBody) {
      res.send(cachedBody);
      return;
    } else {
      res.sendResponse = res.send;
      res.send = (body) => {
        mcache.put(key, body, duration * 1000);
        res.sendResponse(body);
      };
      next();
    }
  };
};

// Updated CORS configuration for development
const corsOptions = {
  origin: '*', // Allow any origin with API key validation
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  exposedHeaders: ['Content-Disposition', 'X-Expires-In'],
  optionsSuccessStatus: 200
};

// Apply compression middleware
processingApp.use(compression());
downloadApp.use(compression());

processingApp.use(cors(corsOptions));
downloadApp.use(cors(corsOptions));

// Security middleware with adjusted settings for development
const helmetConfig = {
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  contentSecurityPolicy: false,
};

processingApp.use(helmet(helmetConfig));
downloadApp.use(helmet(helmetConfig));

// Parse JSON bodies
processingApp.use(express.json());
downloadApp.use(express.json());

// API Key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers.authorization?.split(" ")[1];

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }

  next();
};

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(32).toString("hex");
    cb(null, `${uniqueId}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2000 * 1024 * 1024 }, // 2GB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

// Constants
const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 24 hours
const VIDEOS_DIR = path.join(__dirname, "videos");

// Initialize storage
async function initializeStorage() {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });
  await fs.mkdir("uploads", { recursive: true });
}

// Generate unique folder name
function generateUniqueFolderId() {
  return crypto.randomBytes(32).toString("hex");
}

// Clean up expired videos
async function cleanupExpiredVideos() {
  try {
    const folders = await fs.readdir(VIDEOS_DIR);
    const now = Date.now();

    for (const folder of folders) {
      const folderPath = path.join(VIDEOS_DIR, folder);
      const statsPath = path.join(folderPath, "stats.json");

      try {
        const stats = JSON.parse(await fs.readFile(statsPath, "utf8"));
        if (now - stats.createdAt > EXPIRATION_TIME) {
          await fs.rm(folderPath, { recursive: true, force: true });
          console.log(`Cleaned up expired folder: ${folder}`);
        }
      } catch (error) {
        console.error(`Error processing folder ${folder}:`, error);
      }
    }
  } catch (error) {
    console.error("Error in cleanup:", error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredVideos, 60 * 60 * 1000);

// Get Zoho Mail access token
async function getZohoAccessToken() {
  try {
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        grant_type: 'client_credentials',
        client_id: ZOHO_CLIENT_ID,
        client_secret: ZOHO_CLIENT_SECRET,
        scope: 'ZohoMail.messages.CREATE'
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting Zoho access token:', error);
    throw error;
  }
}

// Send email notification
async function sendEmailNotification(email, videoData) {
  try {
    const accessToken = await getZohoAccessToken();
    const downloadUrl = `${process.env.FRONTEND_URL || 'https://rsizevideo.com'}/download/${videoData.folderId}/${videoData.filename}`;
    
    const emailContent = {
      fromAddress: ZOHO_MAIL_FROM,
      toAddress: email,
      subject: "¡Descarga ya tu video comprimido!",
      content: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; border-radius: 10px;">
          <h1 style="color: #2563eb; text-align: center; margin-bottom: 30px;">¡Video Comprimido!</h1>
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin-bottom: 20px;">
            Tu video ha sido comprimido exitosamente. Hemos reducido el tamaño en un <strong>${videoData.reductionPercentage}%</strong>.
          </p>
          <div style="background-color: #eef2ff; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
            <p style="margin: 0; font-size: 14px; color: #4b5563;">
              <strong>Tamaño original:</strong> ${(videoData.originalSize / (1024 * 1024)).toFixed(2)} MB
            </p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #4b5563;">
              <strong>Nuevo tamaño:</strong> ${(videoData.newSize / (1024 * 1024)).toFixed(2)} MB
            </p>
          </div>
          <div style="text-align: center; margin-bottom: 30px;">
            <a href="${downloadUrl}" style="display: inline-block; background-color: #2563eb; color: white; font-weight: bold; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-size: 16px;">Descargar Video</a>
          </div>
          <p style="font-size: 14px; color: #6b7280; text-align: center; margin-top: 30px;">
            Este enlace expirará en 24 horas. Gracias por usar nuestro servicio de compresión de videos.
          </p>
        </div>
      `,
      mailFormat: "html"
    };

    await axios.post('https://mail.zoho.com/api/accounts/self/messages', emailContent, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Email notification sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending email notification:', error);
    return false;
  }
}

// Process video endpoint
processingApp.post("/process-video", validateApiKey, (req, res) => {
  upload.single("video")(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { targetSize, email } = req.body;
    if (!targetSize) {
      return res.status(400).json({ error: "Target size is required" });
    }

    const inputPath = req.file.path;
    const uniqueFolderId = generateUniqueFolderId();
    const outputDir = path.join(VIDEOS_DIR, uniqueFolderId);
    const originalName = path.parse(req.file.originalname).name;
    const outputFilename = `${originalName}-rsizevideo-com.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    try {
      await fs.mkdir(outputDir);

      const startTime = Date.now();
      const videoInfo = await getVideoInfo(inputPath);
      const originalSize = videoInfo.size;
      
      // Validate target size
      const originalSizeMB = originalSize / (1024 * 1024);
      const targetSizeMB = Number(targetSize);
      
      if (targetSizeMB >= originalSizeMB) {
        await fs.unlink(inputPath);
        return res.status(400).json({ 
          error: "Target size must be smaller than the original file size",
          originalSize: originalSizeMB
        });
      }

      // Return response immediately if email is provided
      if (email) {
        // Send initial response
        res.json({
          folderId: uniqueFolderId,
          filename: outputFilename,
          expiresAt: new Date(Date.now() + EXPIRATION_TIME).toISOString(),
          originalSize,
          estimatedNewSize: originalSize * (targetSizeMB / originalSizeMB),
          estimatedReductionPercentage: (100 - (targetSizeMB / originalSizeMB) * 100).toFixed(2),
          emailNotification: true,
          email
        });

        // Continue processing in the background
        try {
          await compressVideo(inputPath, outputPath, targetSizeMB, videoInfo);
          
          const endTime = Date.now();
          const compressionTime = (endTime - startTime) / 1000;

          const stats = await fs.stat(outputPath);
          const newSize = stats.size;
          const reductionPercentage = ((originalSize - newSize) / originalSize) * 100;

          // Save stats
          const statsData = {
            createdAt: Date.now(),
            originalSize,
            newSize,
            reductionPercentage,
            compressionTime,
            originalFilename: req.file.originalname,
            email
          };

          await fs.writeFile(
            path.join(outputDir, "stats.json"),
            JSON.stringify(statsData)
          );

          // Send email notification
          await sendEmailNotification(email, {
            folderId: uniqueFolderId,
            filename: outputFilename,
            originalSize,
            newSize,
            reductionPercentage: reductionPercentage.toFixed(2)
          });

          // Clean up input file
          await fs.unlink(inputPath);
        } catch (error) {
          console.error("Background processing error:", error);
          try {
            await fs.unlink(inputPath);
          } catch (deleteError) {
            console.error("Error deleting input file:", deleteError);
          }
        }
      } else {
        // Regular synchronous processing
        await compressVideo(inputPath, outputPath, targetSizeMB, videoInfo);
        
        const endTime = Date.now();
        const compressionTime = (endTime - startTime) / 1000;

        const stats = await fs.stat(outputPath);
        const newSize = stats.size;
        const reductionPercentage = ((originalSize - newSize) / originalSize) * 100;

        // Save stats
        const statsData = {
          createdAt: Date.now(),
          originalSize,
          newSize,
          reductionPercentage,
          compressionTime,
          originalFilename: req.file.originalname,
        };

        await fs.writeFile(
          path.join(outputDir, "stats.json"),
          JSON.stringify(statsData)
        );

        // Clean up input file
        await fs.unlink(inputPath);

        // Return the unique folder ID and filename for frontend storage
        res.json({
          folderId: uniqueFolderId,
          filename: outputFilename,
          expiresAt: new Date(Date.now() + EXPIRATION_TIME).toISOString(),
          originalSize,
          newSize,
          reductionPercentage: reductionPercentage.toFixed(2),
          compressionTime,
        });
      }
    } catch (error) {
      console.error("Error:", error);
      try {
        await fs.unlink(inputPath);
      } catch (deleteError) {
        console.error("Error deleting input file:", deleteError);
      }
      res.status(500).json({ error: "Failed to process video" });
    }
  });
});

// Download endpoint with caching for faster responses
downloadApp.get("/download-video/:folderId/:filename", cache(60), async (req, res) => {
  const { folderId, filename } = req.params;
  const filePath = path.join(VIDEOS_DIR, folderId, filename);
  const statsPath = path.join(VIDEOS_DIR, folderId, "stats.json");

  try {
    const stats = JSON.parse(await fs.readFile(statsPath, "utf8"));
    const now = Date.now();

    if (now - stats.createdAt > EXPIRATION_TIME) {
      await fs.rm(path.join(VIDEOS_DIR, folderId), { recursive: true, force: true });
      return res.status(404).json({ error: "File has expired" });
    }

    const timeRemaining = EXPIRATION_TIME - (now - stats.createdAt);
    const hoursRemaining = Math.floor(timeRemaining / (60 * 60 * 1000));
    const minutesRemaining = Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000));

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Expires-In", `${hoursRemaining}h ${minutesRemaining}m`);

    res.sendFile(filePath);
  } catch (error) {
    console.error("Error:", error);
    res.status(404).json({ error: "File not found or has expired" });
  }
});

// Add a health check endpoint
processingApp.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

downloadApp.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Video info helper - optimized for speed
async function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) reject(err);
      else
        resolve({
          ...metadata.format,
          size: metadata.format.size,
        });
    });
  });
}

// Video compression helper - optimized for speed
async function compressVideo(inputPath, outputPath, targetSizeMB, videoInfo) {
  const targetSizeBytes = targetSizeMB * 1024 * 1024;
  const videoBitrate = Math.floor((targetSizeBytes * 8) / videoInfo.duration) - 128000; // Reserve 128k for audio

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset faster", // Using faster preset for speed
        `-b:v ${videoBitrate}`,
        "-pass 1",
        "-f null",
        "-threads 0" // Use all available CPU cores
      ])
      .output("/dev/null")
      .on("end", () => {
        ffmpeg(inputPath)
          .outputOptions([
            "-c:v libx264",
            "-preset faster", // Using faster preset for speed
            `-b:v ${videoBitrate}`,
            "-pass 2",
            "-c:a aac",
            "-b:a 128k",
            "-threads 0" // Use all available CPU cores
          ])
          .output(outputPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      })
      .on("error", reject)
      .run();
  });
}

// Start servers
initializeStorage().then(() => {
  processingApp.listen(processingPort, "0.0.0.0", () => {
    console.log(`Processing server running on port ${processingPort}`);
    cleanupExpiredVideos();
  });

  downloadApp.listen(downloadPort, "0.0.0.0", () => {
    console.log(`Download server running on port ${downloadPort}`);
  });
});