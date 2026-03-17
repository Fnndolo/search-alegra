const axios = require('axios');
require('dotenv').config();

// Configuración
const STORE = 'pasto'; // Cambia aquí la tienda: 'pasto', 'medellin', 'armenia', 'pereira'

// Credenciales de Alegra por tienda
const STORE_CREDENTIALS = {
  pasto: process.env.PASTO_API_KEY,
  medellin: process.env.MEDELLIN_API_KEY,
  armenia: process.env.ARMENIA_API_KEY,
  pereira: process.env.PEREIRA_API_KEY,
};

// Nombres de las tiendas
const STORE_NAMES = {
  pasto: 'SmartGadgets Pasto',
  medellin: 'SmartGadgets Medellín',
  armenia: 'SmartGadgets Armenia',
  pereira: 'SmartGadgets Pereira',
};

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

async function checkInvoicesCount(store) {
  const apiKey = STORE_CREDENTIALS[store];
  const storeName = STORE_NAMES[store];

  if (!apiKey) {
    console.log(
      `${colors.red}❌ ERROR: No se encontró la API KEY para la tienda "${store}"${colors.reset}`,
    );
    console.log(
      `${colors.yellow}Tiendas válidas: pasto, medellin, armenia, pereira${colors.reset}\n`,
    );
    return;
  }

  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(
    `${colors.blue}  Verificador de Facturas en Alegra${colors.reset}`,
  );
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(
    `\n${colors.cyan}🏪 Tienda: ${storeName} (${store})${colors.reset}`,
  );
  console.log(
    `${colors.yellow}⏳ Consultando API de Alegra...${colors.reset}\n`,
  );

  try {
    // Hacer petición a Alegra con metadata para obtener el total
    const authHeader = `Basic ${Buffer.from(apiKey).toString('base64')}`;

    const response = await axios.get('https://api.alegra.com/api/v1/invoices', {
      params: {
        start: 0,
        limit: 1,
        metadata: true,
      },
      headers: {
        Authorization: authHeader,
      },
    });

    const total = response.data.metadata?.total || 0;

    console.log(
      `${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
    );
    console.log(`${colors.green}  ✅ RESULTADO${colors.reset}`);
    console.log(
      `${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
    );
    console.log(
      `\n${colors.magenta}📊 Total de facturas en Alegra: ${colors.cyan}${total.toLocaleString()}${colors.reset}`,
    );
    console.log(`${colors.yellow}🏪 Tienda: ${storeName}${colors.reset}\n`);
    console.log(
      `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`,
    );
  } catch (error) {
    console.log(
      `${colors.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
    );
    console.log(`${colors.red}  ❌ ERROR${colors.reset}`);
    console.log(
      `${colors.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
    );
    console.log(
      `${colors.red}Error consultando Alegra: ${error.message}${colors.reset}`,
    );

    if (error.response) {
      console.log(
        `${colors.yellow}Status: ${error.response.status}${colors.reset}`,
      );
      console.log(
        `${colors.yellow}Data: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`,
      );
    }
    console.log();
  }
}

// Ejecutar el script
checkInvoicesCount(STORE);
