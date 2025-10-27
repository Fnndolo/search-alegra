const axios = require('axios');
const { Client } = require('pg');

// IDs faltantes de facturas de Pasto
const MISSING_IDS = [1];

const STORE = 'pasto';
const API_KEY = 'smartventas016@gmail.com:3484a840715b8402ec57';
const ALEGRA_API_URL = 'https://api.alegra.com/api/v1';

// Configuración de base de datos
const dbClient = new Client({
  host: 'metro.proxy.rlwy.net',
  port: 34115,
  user: 'postgres',
  password: 'PAGJWxTCJoOBrtehUMWNmdmkoyzMEqSz',
  database: 'railway',
  ssl: false
});

// Función para obtener una factura de Alegra
async function fetchInvoiceFromAlegra(invoiceId) {
  try {
    const response = await axios.get(`${ALEGRA_API_URL}/invoices/${invoiceId}`, {
      auth: {
        username: API_KEY.split(':')[0],
        password: API_KEY.split(':')[1]
      }
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`⚠️  Factura ${invoiceId} no existe en Alegra (404)`);
      return null;
    }
    throw error;
  }
}

// Función para obtener los pagos de una factura
async function fetchPaymentsForInvoice(invoiceId) {
  try {
    const response = await axios.get(`${ALEGRA_API_URL}/invoices/${invoiceId}/payments`, {
      auth: {
        username: API_KEY.split(':')[0],
        password: API_KEY.split(':')[1]
      }
    });
    return response.data;
  } catch (error) {
    console.log(`⚠️  No se pudieron obtener pagos para factura ${invoiceId}`);
    return [];
  }
}

// Función para obtener información de cuenta bancaria
async function fetchBankAccountInfo(bankAccountId) {
  try {
    const response = await axios.get(`${ALEGRA_API_URL}/bank-accounts/${bankAccountId}`, {
      auth: {
        username: API_KEY.split(':')[0],
        password: API_KEY.split(':')[1]
      }
    });
    return response.data;
  } catch (error) {
    return null;
  }
}

// Función para guardar factura en la base de datos
async function saveInvoiceToDatabase(invoiceData) {
  const datetime = invoiceData.datetime || null;
  const date = invoiceData.date || null;
  
  // Obtener el nombre de cuenta bancaria del primer pago si existe
  let bankAccountName = null;
  if (invoiceData.payments && invoiceData.payments.length > 0) {
    bankAccountName = invoiceData.payments[0].bankAccountName || null;
  }

  // Verificar que no exista ya una factura con el mismo data->id para esta store
  const checkQuery = `
    SELECT id FROM invoices 
    WHERE store = $1 AND data->>'id' = $2
  `;
  
  const existing = await dbClient.query(checkQuery, [STORE, String(invoiceData.id)]);
  
  if (existing.rows.length > 0) {
    console.log(`   ⚠️  Factura ${invoiceData.id} ya existe en la base de datos`);
    return;
  }

  // Obtener el siguiente ID disponible
  const maxIdQuery = `
    SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM invoices
  `;
  
  const result = await dbClient.query(maxIdQuery);
  const nextId = result.rows[0].next_id;

  const query = `
    INSERT INTO invoices (id, store, data, datetime, date, "bankAccountName", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
  `;
  
  await dbClient.query(query, [nextId, STORE, invoiceData, datetime, date, bankAccountName]);
}

// Función principal
async function loadMissingInvoices() {
  console.log('🚀 Iniciando carga de facturas faltantes...\n');
  console.log(`📊 Total de facturas a cargar: ${MISSING_IDS.length}\n`);

  await dbClient.connect();
  console.log('✅ Conectado a la base de datos\n');

  let loaded = 0;
  let notFound = 0;
  let errors = 0;

  for (let i = 0; i < MISSING_IDS.length; i++) {
    const invoiceId = MISSING_IDS[i];
    
    try {
      console.log(`[${i + 1}/${MISSING_IDS.length}] Procesando factura ${invoiceId}...`);

      // Obtener factura de Alegra
      const invoice = await fetchInvoiceFromAlegra(invoiceId);
      
      if (!invoice) {
        notFound++;
        continue;
      }

      // Obtener pagos
      const payments = await fetchPaymentsForInvoice(invoiceId);
      
      // Si hay pagos, enriquecer con información de cuenta bancaria
      if (payments && payments.length > 0) {
        for (const payment of payments) {
          if (payment.bankAccount?.id) {
            const bankAccountInfo = await fetchBankAccountInfo(payment.bankAccount.id);
            if (bankAccountInfo) {
              payment.bankAccountName = bankAccountInfo.name;
            }
          }
        }
        invoice.payments = payments;
      }

      // Guardar en base de datos
      await saveInvoiceToDatabase(invoice);
      
      console.log(`   ✅ Factura ${invoiceId} cargada exitosamente`);
      loaded++;

      // Pequeña pausa para no saturar la API
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`   ❌ Error procesando factura ${invoiceId}:`, error.message);
      errors++;
    }
  }

  await dbClient.end();

  console.log('\n' + '='.repeat(50));
  console.log('📈 RESUMEN:');
  console.log('='.repeat(50));
  console.log(`✅ Cargadas exitosamente: ${loaded}`);
  console.log(`⚠️  No encontradas en Alegra: ${notFound}`);
  console.log(`❌ Errores: ${errors}`);
  console.log(`📊 Total procesadas: ${loaded + notFound + errors}/${MISSING_IDS.length}`);
  console.log('='.repeat(50));
}

// Ejecutar
loadMissingInvoices()
  .then(() => {
    console.log('\n✨ Proceso completado');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Error fatal:', error);
    process.exit(1);
  });
