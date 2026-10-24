import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'WeHaveCPU API',
        version: '1.0.0'
    },
    paths: {}
};

try {
    const jsonPath = path.join(__dirname, '../docs/swagger.json');
    const yamlPath = path.join(__dirname, '../docs/swagger.yaml');

    if (fs.existsSync(jsonPath) && fs.statSync(jsonPath).size > 0) {
        swaggerSpec = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } else if (fs.existsSync(yamlPath) && fs.statSync(yamlPath).size > 0) {
        swaggerSpec = yaml.parse(fs.readFileSync(yamlPath, 'utf8'));
    }
} catch (error) {
    console.warn('Failed to load Swagger definition:', error.message);
}

export default swaggerSpec;
