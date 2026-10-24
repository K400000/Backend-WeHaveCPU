import 'dotenv/config';
import app from './app.js';
import pool from './config/db.js';
import { startCronJobs } from './utils/cronJobs.js';

const PORT = process.env.PORT;

async function startServer() {
    try {
        const client = await pool.connect();
        console.log('Connected to PostgreSQL Database successfully');
        client.release();

        startCronJobs();

        const server = app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Swagger API Docs: http://localhost:${PORT}/api-docs`);
        });

        const shutdown = async () => {
            console.log('\nGracefully shutting down...');
            server.close(async () => {
                await pool.end();
                console.log('Database pool closed. Exiting process.');
                process.exit(0);
            });
        };

        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
