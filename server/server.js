const express = require("express");
const multer = require("multer");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const nodemailer = require("nodemailer");
const mcache = require("memory-cache");
const cluster = require("cluster");
const numCPUs = require("os").cpus().length;
const { createReadStream } = require("fs");
const { pipeline } = require("stream");
const util = require("util");
const streamPipeline = util.promisify(pipeline);

// Configuración de constantes
const processingPort = 5000;
const downloadPort = 5001;
const API_KEY = "wetrbctyrt23r672429346b8cw9b8erywueyr7123647326489bc18yw89eucr9b1287346bc1ywuerbqwyueirybcqy98r761b237489656231892erbcw89biuo12u3468sdgn01298nc8n1ndi2n8u1nw9dn3717nspskfnw9731n0237461928ubc762yuebcqiwub127934"; // Reemplaza con tu API key real
const FRONTEND_URL = "https://rsizevideo.com"; // URL de tu frontend

// Configuración de Zoho Mail
const ZOHO_MAIL_FROM = "mail.rsizevideo@rsizevideo.com"; // Reemplaza con tu dirección de correo de Zoho
const ZOHO_MAIL_PASSWORD = "tucontraseña"; // Reemplaza con tu contraseña de aplicación de Zoho

// Configuración de recursos
const MAX_MEMORY = 4 * 1024; // 4GB en MB
process.env.NODE_OPTIONS = `--max-old-space-size=${MAX_MEMORY}`;

// Configuración de ffmpeg
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Configuración de nodemailer (inicializado una vez)
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.eu',
  port: 465,
  secure: true,
  auth: {
    user: ZOHO_MAIL_FROM,
    pass: ZOHO_MAIL_PASSWORD
  },
  pool: true, // Usar pool de conexiones para mejor rendimiento
  maxConnections: 10, // Aumentado para mayor paralelismo
  maxMessages: Infinity // Sin límite de mensajes por conexión
});

// Constants
const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 24 hours
const VIDEOS_DIR = path.join(__dirname, "videos");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const TEMP_DIR = path.join(__dirname, "temp");

// Inicializar aplicaciones Express
const processingApp = express();
const downloadApp = express();

// Caché en memoria para respuestas frecuentes
const responseCache = new mcache.Cache();

// Send email notification using nodemailer with Zoho SMTP
async function sendEmailNotification(email, videoData) {
  try {
    const downloadUrl = `${FRONTEND_URL}/download/${videoData.folderId}/${videoData.filename}`;

    // Definir el contenido del correo
    const mailOptions = {
      from: ZOHO_MAIL_FROM,
      to: email,
      subject: "¡Descarga ya tu video comprimido!",
      text: `Tu video ha sido comprimido exitosamente. Hemos reducido el tamaño en un ${videoData.reductionPercentage}%. Descarga tu video aquí: ${downloadUrl}`,
      html: `
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
      `
    };

    // Enviar el correo
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email notification:', error);
    return false;
  }
}

// Cache middleware ultra-optimizado
const cache = (duration) => {
  return (req, res, next) => {
    const key = "__express__" + req.originalUrl || req.url;
    const cachedBody = responseCache.get(key);
    if (cachedBody) {
      res.send(cachedBody);
      return;
    } else {
      res.sendResponse = res.send;
      res.send = (body) => {
        responseCache.put(key, body, duration * 1000);
        res.sendResponse(body);
      };
      next();
    }
  };
};

// Configuración de middleware optimizada para velocidad
const configureApp = (app) => {
  // Compression middleware - optimizado para velocidad
  app.use(compression({
    level: 1, // Nivel de compresión más rápido
    threshold: 10 * 1024, // Solo comprimir respuestas mayores a 10KB
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  // CORS optimizado
  app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    exposedHeaders: ["Content-Disposition", "X-Expires-In"],
    optionsSuccessStatus: 200,
    maxAge: 86400 // Caché de preflight por 24 horas
  }));

  // Helmet optimizado
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    contentSecurityPolicy: false,
  }));

  // JSON parser optimizado
  app.use(express.json({
    limit: '1mb',
    strict: false // Más rápido pero menos estricto
  }));

  // Desactivar X-Powered-By para mejor seguridad y rendimiento
  app.disable('x-powered-by');

  // Aumentar el límite de oyentes para evitar advertencias
  app.setMaxListeners(0);
};

// Configurar ambas aplicaciones
configureApp(processingApp);
configureApp(downloadApp);

// API Key validation middleware optimizado
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers.authorization?.split(" ")[1];

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }

  next();
};

// File upload configuration - optimizado para máxima velocidad
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Método ultra rápido para generar IDs únicos
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    cb(null, `${uniqueId}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 4000 * 1024 * 1024, // 4GB limit
    files: 1 // Solo un archivo a la vez
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

// Initialize storage
async function initializeStorage() {
  await Promise.all([
    fs.mkdir(VIDEOS_DIR, { recursive: true }),
    fs.mkdir(UPLOADS_DIR, { recursive: true }),
    fs.mkdir(TEMP_DIR, { recursive: true })
  ]);
}

// Generate unique folder name - método ultra rápido
function generateUniqueFolderId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// Clean up expired videos - optimizado para rendimiento máximo
async function cleanupExpiredVideos() {
  try {
    const folders = await fs.readdir(VIDEOS_DIR);
    const now = Date.now();
    const deletePromises = [];

    for (const folder of folders) {
      const folderPath = path.join(VIDEOS_DIR, folder);
      const statsPath = path.join(folderPath, "stats.json");

      try {
        const statsData = await fs.readFile(statsPath, "utf8");
        const stats = JSON.parse(statsData);

        if (now - stats.createdAt > EXPIRATION_TIME) {
          deletePromises.push(
            fs.rm(folderPath, { recursive: true, force: true })
              .then(() => console.log(`Cleaned up expired folder: ${folder}`))
              .catch(err => console.error(`Error deleting folder ${folder}:`, err))
          );
        }
      } catch (error) {
        // Si hay error al leer stats, probablemente el archivo está corrupto o no existe
        // Eliminar el directorio por seguridad después de 48 horas
        try {
          const folderStats = await fs.stat(folderPath);
          if (now - folderStats.birthtimeMs > EXPIRATION_TIME * 2) {
            deletePromises.push(
              fs.rm(folderPath, { recursive: true, force: true })
                .then(() => console.log(`Cleaned up old folder without stats: ${folder}`))
                .catch(err => console.error(`Error deleting folder ${folder}:`, err))
            );
          }
        } catch (statError) {
          console.error(`Error getting stats for folder ${folder}:`, statError);
        }
      }
    }

    // Ejecutar todas las eliminaciones en paralelo
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
    }

    // También limpiar la carpeta de uploads (archivos temporales)
    try {
      const uploadFiles = await fs.readdir(UPLOADS_DIR);
      const uploadDeletePromises = [];

      for (const file of uploadFiles) {
        const filePath = path.join(UPLOADS_DIR, file);
        try {
          const fileStats = await fs.stat(filePath);
          // Eliminar archivos de más de 24 horas
          if (now - fileStats.birthtimeMs > EXPIRATION_TIME) {
            uploadDeletePromises.push(
              fs.unlink(filePath)
                .then(() => console.log(`Cleaned up old upload file: ${file}`))
                .catch(err => console.error(`Error deleting upload file ${file}:`, err))
            );
          }
        } catch (statError) {
          console.error(`Error getting stats for upload file ${file}:`, statError);
        }
      }

      if (uploadDeletePromises.length > 0) {
        await Promise.all(uploadDeletePromises);
      }
    } catch (uploadError) {
      console.error("Error cleaning upload directory:", uploadError);
    }
  } catch (error) {
    console.error("Error in cleanup:", error);
  }
}

// Video info helper - optimizado para velocidad máxima
async function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, {
      probesize: 5000000, // 5MB de datos para análisis (más rápido)
      analyzeduration: 5000000 // 5 segundos de análisis (más rápido)
    }, (err, metadata) => {
      if (err) reject(err);
      else
        resolve({
          ...metadata.format,
          size: metadata.format.size,
        });
    });
  });
}

// Video compression helper - optimizado para velocidad máxima
async function compressVideo(inputPath, outputPath, targetSizeMB, videoInfo) {
  const targetSizeBytes = targetSizeMB * 1024 * 1024;
  const videoBitrate = Math.floor((targetSizeBytes * 8) / videoInfo.duration) - 128000; // Reserve 128k for audio

  // Crear directorios temporales para los archivos de paso
  const passLogPath = path.join(TEMP_DIR, `ffmpeg2pass-${Date.now()}`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v libx264",
        "-preset ultrafast", // Máxima velocidad
        `-b:v ${videoBitrate}`,
        "-pass 1",
        `-passlogfile ${passLogPath}`,
        "-f null",
        "-threads 0", // Usar todos los núcleos disponibles
        "-tune fastdecode", // Optimizar para decodificación rápida
        "-tune zerolatency", // Optimizar para latencia cero
        "-profile:v baseline", // Perfil más rápido
        "-level 3.0", // Nivel de compatibilidad
        "-pix_fmt yuv420p" // Formato de píxel más compatible y rápido
      ])
      .output("/dev/null")
      .on("end", () => {
        ffmpeg(inputPath)
          .outputOptions([
            "-c:v libx264",
            "-preset ultrafast", // Máxima velocidad
            `-b:v ${videoBitrate}`,
            "-pass 2",
            `-passlogfile ${passLogPath}`,
            "-c:a aac",
            "-b:a 128k",
            "-threads 0", // Usar todos los núcleos disponibles
            "-tune fastdecode", // Optimizar para decodificación rápida
            "-tune zerolatency", // Optimizar para latencia cero
            "-movflags +faststart", // Optimizar para inicio rápido
            "-profile:v baseline", // Perfil más rápido
            "-level 3.0", // Nivel de compatibilidad
            "-pix_fmt yuv420p" // Formato de píxel más compatible y rápido
          ])
          .output(outputPath)
          .on("end", () => {
            // Limpiar archivos temporales de paso
            try {
              fsSync.unlinkSync(`${passLogPath}-0.log`);
              fsSync.unlinkSync(`${passLogPath}-0.log.mbtree`);
            } catch (e) {
              console.error("Error cleaning up pass log files:", e);
            }
            resolve();
          })
          .on("error", (err) => {
            // Limpiar archivos temporales de paso en caso de error
            try {
              fsSync.unlinkSync(`${passLogPath}-0.log`);
              fsSync.unlinkSync(`${passLogPath}-0.log.mbtree`);
            } catch (e) {
              console.error("Error cleaning up pass log files:", e);
            }
            reject(err);
          })
          .run();
      })
      .on("error", reject)
      .run();
  });
}

// Process video endpoint - optimizado para rendimiento máximo
processingApp.post("/process-video", validateApiKey, upload.single("video"), async (req, res) => {
  if (req.file === undefined) {
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
      (async () => {
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
      })().catch(err => console.error("Async processing error:", err));
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

// Download endpoint optimizado para streaming rápido
downloadApp.get("/download/:folderId/:filename", cache(60), async (req, res) => {
  const { folderId, filename } = req.params;
  const filePath = path.join(VIDEOS_DIR, folderId, filename);
  const statsPath = path.join(VIDEOS_DIR, folderId, "stats.json");

  try {
    // Verificar si el archivo existe primero (más rápido)
    try {
      await fs.access(filePath);
    } catch (err) {
      return res.status(404).json({ error: "File not found" });
    }

    // Verificar la expiración
    const stats = JSON.parse(await fs.readFile(statsPath, "utf8"));
    const now = Date.now();

    if (now - stats.createdAt > EXPIRATION_TIME) {
      // Programar eliminación asíncrona para no bloquear la respuesta
      fs.rm(path.join(VIDEOS_DIR, folderId), { recursive: true, force: true })
        .catch(err => console.error(`Error deleting expired folder ${folderId}:`, err));

      return res.status(404).json({ error: "File has expired" });
    }

    const timeRemaining = EXPIRATION_TIME - (now - stats.createdAt);
    const hoursRemaining = Math.floor(timeRemaining / (60 * 60 * 1000));
    const minutesRemaining = Math.floor((timeRemaining % (60 * 60 * 1000)) / (60 * 1000));

    // Optimizar cabeceras para streaming y caché
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Expires-In", `${hoursRemaining}h ${minutesRemaining}m`);
    res.setHeader("Cache-Control", "public, max-age=3600"); // Caché de 1 hora
    res.setHeader("Accept-Ranges", "bytes"); // Permitir descarga parcial

    // Obtener información del archivo
    const fileStats = await fs.stat(filePath);
    const fileSize = fileStats.size;

    // Manejar solicitudes de rango (descarga parcial)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Content-Length", chunkSize);
      res.status(206); // Partial Content

      const fileStream = fsSync.createReadStream(filePath, { start, end });
      fileStream.pipe(res);
    } else {
      // Descarga completa
      res.setHeader("Content-Length", fileSize);
      const fileStream = fsSync.createReadStream(filePath);
      fileStream.pipe(res);
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(404).json({ error: "File not found or has expired" });
  }
});

// Health check endpoints optimizados
processingApp.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", memory: process.memoryUsage() });
});

downloadApp.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", memory: process.memoryUsage() });
});

// Iniciar servidores
async function startServers() {
  await initializeStorage();

  processingApp.listen(processingPort, "0.0.0.0", () => {
    console.log(`Processing server running on port ${processingPort}`);
    // Ejecutar limpieza inicial y programar limpieza periódica
    cleanupExpiredVideos();
    setInterval(cleanupExpiredVideos, 30 * 60 * 1000); // Cada 30 minutos
  });

  downloadApp.listen(downloadPort, "0.0.0.0", () => {
    console.log(`Download server running on port ${downloadPort}`);
  });
}

// Iniciar servidores
startServers().catch(err => {
  console.error("Failed to start servers:", err);
  process.exit(1);
});
