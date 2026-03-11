const axios = require('axios');

// Configuración
const BASE_URL = 'http://localhost:3000'; // Cambia esto si tu servidor está en otro puerto
const STORE = 'pasto';
const BILL_IDS = [5150];

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

async function loadBill(billId) {
  try {
    console.log(`${colors.cyan}⏳ Cargando bill #${billId}...${colors.reset}`);

    const response = await axios.get(`${BASE_URL}/bills/update-single`, {
      params: {
        store: STORE,
        billId: billId.toString(),
      },
    });

    console.log(
      `${colors.green}✅ Bill #${billId} cargada exitosamente${colors.reset}`,
    );
    return { id: billId, status: 'success', data: response.data };
  } catch (error) {
    console.error(
      `${colors.red}❌ Error cargando bill #${billId}: ${error.message}${colors.reset}`,
    );
    return { id: billId, status: 'error', error: error.message };
  }
}

async function loadAllBills() {
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(`${colors.blue}  Cargador de Bills de Medellín${colors.reset}`);
  console.log(
    `${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.log(
    `\n${colors.yellow}📦 Total de bills a cargar: ${BILL_IDS.length}${colors.reset}`,
  );
  console.log(`${colors.yellow}🏪 Tienda: ${STORE}${colors.reset}\n`);

  const results = [];
  let successCount = 0;
  let errorCount = 0;

  // Cargar bills de una en una con un pequeño delay
  for (let i = 0; i < BILL_IDS.length; i++) {
    const billId = BILL_IDS[i];
    const result = await loadBill(billId);
    results.push(result);

    if (result.status === 'success') {
      successCount++;
    } else {
      errorCount++;
    }

    // Pequeño delay entre requests para no saturar el servidor
    if (i < BILL_IDS.length - 1) {
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
  console.log(`${colors.cyan}📊 Total: ${BILL_IDS.length}${colors.reset}`);

  // Mostrar bills con error si las hay
  if (errorCount > 0) {
    console.log(`\n${colors.yellow}⚠️  Bills con error:${colors.reset}`);
    results
      .filter((r) => r.status === 'error')
      .forEach((r) => {
        console.log(
          `${colors.red}   - Bill #${r.id}: ${r.error}${colors.reset}`,
        );
      });
  }

  console.log(
    `\n${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`,
  );
}

// Ejecutar el script
loadAllBills().catch((error) => {
  console.error(`${colors.red}💥 Error fatal: ${error.message}${colors.reset}`);
  process.exit(1);
});
