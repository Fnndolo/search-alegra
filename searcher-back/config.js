require('dotenv').config();

const env = process.env;

function getNodeEnv() {
    return env.NODE_ENV || 'development';
}

function getPort() {
    return parseInt(env.PORT || '3001', 10);
}

function getFrontendOrigin() {
    return env.FRONTEND_ORIGIN;
}

function getCorsOrigins() {
    return [
        getFrontendOrigin(),
        'http://localhost:4200',
        'https://search-alegra-production-5eed.up.railway.app',
        'https://amusing-simplicity-production.up.railway.app',
        'http://localhost:3000',
        'http://127.0.0.1:4200',
    ].filter(Boolean);
}

function getDatabaseConfig() {
    return {
        url: env.DATABASE_URL,
        host: env.DATABASE_HOST || 'localhost',
        port: parseInt(env.DATABASE_PORT || '5432', 10),
        username: env.DATABASE_USERNAME || 'postgres',
        password: env.DATABASE_PASSWORD || 'postgres',
        database: env.DATABASE_NAME || 'alegra_search',
        ssl: getNodeEnv() === 'production' ? { rejectUnauthorized: false } : false,
    };
}

function getDatabaseConnectionString() {
    return env.DATABASE_URL;
}

function getAlegraBaseUrl() {
    return env.ALEGRA_BASE_URL || 'https://api.alegra.com/api/v1';
}

function getAlegraApiUrl() {
    return env.ALEGRA_API_URL || `${getAlegraBaseUrl()}/invoices`;
}

function getAlegraBillsApiUrl() {
    return env.ALEGRA_BILLS_API_URL || `${getAlegraBaseUrl()}/bills`;
}

function getWebhookBaseUrl() {
    return env.WEBHOOK_BASE_URL;
}

const storeApiKeys = {
    pasto: env.PASTO_API_KEY,
    medellin: env.MEDELLIN_API_KEY,
    armenia: env.ARMENIA_API_KEY,
    pereira: env.PEREIRA_API_KEY,
    bogota: env.BOGOTA_API_KEY,
};

function getStoreApiKey(store) {
    return storeApiKeys[store];
}

function getStoreCredentials(store) {
    const normalizedStore = String(store || '').toLowerCase();

    return {
        apiKey: getStoreApiKey(normalizedStore),
        alegraBaseUrl: getAlegraBaseUrl(),
        alegraApiUrl: env[`ALEGRA_API_URL_${normalizedStore.toUpperCase()}`] || getAlegraApiUrl(),
        alegraBillsApiUrl: env[`ALEGRA_BILLS_API_URL_${normalizedStore.toUpperCase()}`] || getAlegraBillsApiUrl(),
    };
}

function getJwtSecret() {
    return env.JWT_SECRET || 'smart_alegra_secret_2026';
}

function getAlegraKupoCredentials() {
    return {
        email: env.ALEGRA_KUPO_EMAIL || 'facturacionkupocell@gmail.com',
        token: env.ALEGRA_KUPO_TOKEN || '4ea4a9d5447c6ca04d00',
    };
}

function getAdminSeedCredentials() {
    return {
        username: env.ADMIN_SEED_USERNAME || 'admin',
        password: env.ADMIN_SEED_PASSWORD || 'Admin123!',
        email: env.ADMIN_SEED_EMAIL || 'admin@smartgadgets.com',
    };
}

function getWebhookUrl(store) {
    if (!getWebhookBaseUrl()) {
        return null;
    }

    return `${getWebhookBaseUrl()}/${store}`;
}

module.exports = {
    getNodeEnv,
    getPort,
    getFrontendOrigin,
    getCorsOrigins,
    getDatabaseConfig,
    getDatabaseConnectionString,
    getAlegraBaseUrl,
    getAlegraApiUrl,
    getAlegraBillsApiUrl,
    getWebhookBaseUrl,
    getJwtSecret,
    getAlegraKupoCredentials,
    getAdminSeedCredentials,
    storeApiKeys,
    getStoreApiKey,
    getStoreCredentials,
    getWebhookUrl,
};