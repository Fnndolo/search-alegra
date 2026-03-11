const axios = require('axios');

// Configuración
const BASE_URL = 'http://localhost:3000'; // Cambia esto si tu servidor está en otro puerto
const STORE = 'medellin';
const INVOICE_IDS = [
  15221, 12930, 12931, 12932, 12933, 12873, 12874, 12875, 12876, 12868, 12869,
  12870, 12871, 11795, 11796, 11797, 11649, 11650, 10578, 10552, 10064, 10065,
  10066, 10067, 10068, 10069, 10070, 10071,
]; // 👈 AGREGA AQUÍ LOS IDs DE LAS FACTURAS: [1234, 1235, 1236, ...]

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

async function loadInvoice(invoiceId) {
  try {
    console.log(
      `${colors.cyan}⏳ Cargando factura #${invoiceId}...${colors.reset}`,
    );

    const response = await axios.get(`${BASE_URL}/invoices/update-single`, {
      params: {
        store: STORE,
        invoiceId: invoiceId.toString(),
      },
    });

    console.log(
      `${colors.green}✅ Factura #${invoiceId} cargada exitosamente${colors.reset}`,
    );
    return { id: invoiceId, status: 'success', data: response.data };
  } catch (error) {
    console.error(
      `${colors.red}❌ Error cargando factura #${invoiceId}: ${error.message}${colors.reset}`,
    );
    return { id: invoiceId, status: 'error', error: error.message };
  }
}

async function loadAllInvoices() {
  if (INVOICE_IDS.length === 0) {
    console.log(
      `${colors.red}❌ ERROR: No hay IDs de facturas configurados${colors.reset}`,
    );
    console.log(
      `${colors.yellow}Por favor, edita el archivo y agrega los IDs en la línea 6:${colors.reset}`,
    );
    console.log(
      `${colors.cyan}const INVOICE_IDS = [1234, 1235, 1236, ...];${colors.reset}\n`,
    );
    return;
  }

  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(
    `${colors.blue}  Cargador de Facturas de Medellín${colors.reset}`,
  );
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(
    `\n${colors.yellow}📦 Total de facturas a cargar: ${INVOICE_IDS.length}${colors.reset}`,
  );
  console.log(`${colors.yellow}🏪 Tienda: ${STORE}${colors.reset}\n`);

  const results = [];
  let successCount = 0;
  let errorCount = 0;

  // Cargar facturas de una en una con un pequeño delay
  for (let i = 0; i < INVOICE_IDS.length; i++) {
    const invoiceId = INVOICE_IDS[i];
    const result = await loadInvoice(invoiceId);
    results.push(result);

    if (result.status === 'success') {
      successCount++;
    } else {
      errorCount++;
    }

    // Pequeño delay entre requests para no saturar el servidor
    if (i < INVOICE_IDS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Resumen final
  console.log(
    `\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(`${colors.blue}  Resumen${colors.reset}`);
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(`${colors.green}✅ Exitosas: ${successCount}${colors.reset}`);
  console.log(`${colors.red}❌ Errores: ${errorCount}${colors.reset}`);
  console.log(`${colors.cyan}📊 Total: ${INVOICE_IDS.length}${colors.reset}`);

  // Mostrar facturas con error si las hay
  if (errorCount > 0) {
    console.log(`\n${colors.yellow}⚠️  Facturas con error:${colors.reset}`);
    results
      .filter((r) => r.status === 'error')
      .forEach((r) => {
        console.log(
          `${colors.red}   - Factura #${r.id}: ${r.error}${colors.reset}`,
        );
      });
  }

  console.log(
    `\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`,
  );
}

// Ejecutar el script
loadAllInvoices().catch((error) => {
  console.error(`${colors.red}💥 Error fatal: ${error.message}${colors.reset}`);
  process.exit(1);
});
