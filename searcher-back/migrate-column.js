const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:PAGJWxTCJoOBrtehUMWNmdmkoyzMEqSz@metro.proxy.rlwy.net:34115/railway'
});

async function migrate() {
  try {
    await client.connect();
    console.log('✅ Conectado a la base de datos');
    
    // Renombrar columna
    await client.query('ALTER TABLE invoices RENAME COLUMN "paymentMethod" TO "bankAccountName"');
    console.log('✅ Columna renombrada exitosamente: paymentMethod → bankAccountName');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

migrate();
