import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';

import apiRoutes from './routes/index.js';
import errorHandler from './middlewares/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 1. Core Middlewares
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 2. Static Files (รูปภาพสินค้าและโปรไฟล์)
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 3. API Documentation (Swagger UI)
const swaggerFile = fs.readFileSync(path.join(__dirname, 'swagger.yaml'), 'utf8');
const swaggerDocument = YAML.parse(swaggerFile);

const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 3000;
swaggerDocument.servers = [
    { url: `http://${host}:${port}`, description: `Server (${host}:${port})` }
];

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 4. Root Welcome Endpoint
app.get('/', (req, res) => {
    res.status(200).json({ success: true, message: 'OK' });
});

// 5. Mount API Routes เข้ากับ Prefix /api
app.use('/api', apiRoutes);

// 6. 404 Handler สำหรับ Route ที่ไม่มีอยู่จริง
app.use((req, res, next) => {
    res.status(404).json({ success: false, message: 'Resource not found' });
});

// 6. Global Error Handling Middleware (ต้องอยู่ล่างสุดเสมอ)
app.use(errorHandler);

export default app;
