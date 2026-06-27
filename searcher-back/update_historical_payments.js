const axios = require('axios');
const { Client } = require('pg');
const { getDatabaseConnectionString, getStoreApiKey } = require('./config');

// Mapeo de tiendas con sus API Keys
const STORES = {
  pasto: getStoreApiKey('pasto'),
  medellin: getStoreApiKey('medellin'),
  armenia: getStoreApiKey('armenia'),
  pereira: getStoreApiKey('pereira')
};

const DATABASE_URL = getDatabaseConnectionString();
const ALEGRA_API_URL = 'https://api.alegra.com/api/v1/invoices';
const ALEGRA_PAYMENTS_URL = 'https://api.alegra.com/api/v1/payments';

const START_DATE = '2026-01-01'; // "Desde el primer día de enero"
const END_DATE = new Date().toISOString().split('T')[0]; // "Hasta el día de hoy"

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchBankName(paymentId, apiKey) {
  try {
    const auth = 'Basic ' + Buffer.from(apiKey).toString('base64');
    const response = await axios.get(`${ALEGRA_PAYMENTS_URL}/${paymentId}`, {
      headers: { Authorization: auth }
    });
    if (response.data && response.data.bankAccount && response.data.bankAccount.name) {
      return response.data.bankAccount.name;
    }
    return null;
  } catch (error) {
    console.warn(`    ⚠️ Error obteniendo detalles del pago ${paymentId}: ${error.message}`);
    return null;
  }
}

async function run() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }

  console.log(`\n🚀 INICIANDO SCRIPT DE ACTUALIZACIÓN HISTÓRICA DE PAGOS FALTANTES 🚀`);
  console.log(`📅 Rango de fechas: Desde ${START_DATE} hasta ${END_DATE}\n`);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`✅ Conectado a la base de datos PostgreSQL`);

  try {
    for (const [store, apiKey] of Object.entries(STORES)) {
      if (!apiKey) {
        console.warn(`⏭️  Saltando tienda ${store.toUpperCase()} - No hay API Key configurada.`);
        continue;
      }

      console.log(`\n======================================================`);
      console.log(`🏢 PROCESANDO TIENDA: ${store.toUpperCase()}`);
      console.log(`======================================================`);

      // Buscar facturas en la base de datos de esta tienda, en el rango de fechas 
      // y que NO tengan cuenta de banco asignada (NULL o array vacío)
      const query = `
        SELECT data->>'id' as id, data->>'datetime' as datetime, "billingStatus"
        FROM invoices
        WHERE store = $1
          AND date >= $2
          AND date <= $3
          AND (
            data->>'paymentBankAccounts' IS NULL
            OR jsonb_array_length(data->'paymentBankAccounts') = 0
            OR "paymentBankAccounts" IS NULL
            OR jsonb_array_length("paymentBankAccounts") = 0
          )
        ORDER BY CAST(data->>'id' AS INTEGER) ASC
      `;
      
      const res = await client.query(query, [store, START_DATE, END_DATE]);
      const invoicesSinPago = res.rows;

      if (invoicesSinPago.length === 0) {
        console.log(`✅ No hay facturas sin pagos registrados en ${store} entre ${START_DATE} y ${END_DATE}.`);
        continue;
      }

      console.log(`🔍 Encontradas ${invoicesSinPago.length} facturas sin pago(s) en base de datos. Consultando con Alegra...`);

      let procesadasConExito = 0;
      let procesadasSinCambios = 0;
      
      const auth = 'Basic ' + Buffer.from(apiKey).toString('base64');

      // Iteramos factura por factura consultando a la API de Alegra (con delay para evitar límite)
      for (const invoiceRow of invoicesSinPago) {
        const invoiceId = invoiceRow.id;
        try {
          // Consultar la factura actualizada a Alegra
          const response = await axios.get(`${ALEGRA_API_URL}/${invoiceId}`, {
            headers: { Authorization: auth }
          });
          const invoiceData = response.data;
          
          await delay(300); // 300ms de pausa para cuidar los tokens de la API

          // Verificamos si en Alegra SÍ tiene pagos (puede seguir sin pagos si fue a crédito y no han pagado)
          if (invoiceData.payments && invoiceData.payments.length > 0) {
            console.log(`  💳 Factura #${invoiceId} SÍ tiene pagos en Alegra. Procesando bancos...`);
            
            // Buscar los nombres reales de los bancos
            const detailedBankAccounts = [];
            for (const payment of invoiceData.payments) {
              if (payment.id) {
                const bankName = await fetchBankName(payment.id, apiKey);
                await delay(200); // Pequeña pausa
                if (bankName) {
                  detailedBankAccounts.push({
                    paymentId: String(payment.id),
                    bankName: bankName,
                    amount: payment.amount || 0
                  });
                }
              }
            }

            // Actualizamos la base de datos con estos pagos
            const firstBankName = detailedBankAccounts.length > 0 ? detailedBankAccounts[0].bankName : null;
            
            // Reasignamos estos campos a invoiceData
            invoiceData.paymentBankAccounts = detailedBankAccounts;
            
            // Actualizamos el JSONB en PostgreSQL
            const updateQuery = `
              UPDATE invoices 
              SET data = $1, 
                  "bankAccountName" = $2, 
                  "paymentBankAccounts" = $3::jsonb 
              WHERE store = $4 AND CAST(data->>'id' AS text) = $5
            `;
            
            await client.query(updateQuery, [
              invoiceData, // $1
              firstBankName, // $2
              JSON.stringify(detailedBankAccounts), // $3
              store, // $4
              invoiceId // $5
            ]);
            
            console.log(`    ✅ Base de datos actualizada Factura #${invoiceId} con ${detailedBankAccounts.length} banco(s)`);
            procesadasConExito++;
          } else {
             // La factura sigue sin pagos en Alegra, no hay nada que actualizar
			 // Descomentar lo siguiente si quieres ver el log de cada omitida:
             // console.log(`  ⏱️ Factura #${invoiceId} aún no tiene pagos en Alegra. (Ignorada)`);
             procesadasSinCambios++;
          }
        } catch (apiError) {
          console.error(`  ❌ Error consultando la API de factura #${invoiceId}:`, apiError.response ? apiError.response.data : apiError.message);
        }
      }

      console.log(`\n📊 RESUMEN PARA ${store.toUpperCase()}:`);
      console.log(`   🔸 Total escaneadas: ${invoicesSinPago.length}`);
      console.log(`   🔹 Actualizadas con pagos: ${procesadasConExito}`);
      console.log(`   🔹 Siguen sin pagos (crédito/borrador): ${procesadasSinCambios}`);
    }

  } catch (err) {
    console.error(`Error general ejecutando script:`, err);
  } finally {
    await client.end();
    console.log(`\n👋 Script finalizado exitosamente. BD desconectada.\n`);
  }
}

run();
