const { Client } = require('pg');
const { getDatabaseConnectionString } = require('./config');

const client = new Client({
  connectionString: getDatabaseConnectionString()
});

async function checkData() {
  try {
    await client.connect();
    console.log('✅ Conectado a la base de datos\n');
    
    // Verificar 5 facturas de pasto
    const result = await client.query(`
      SELECT id, store, 
             data->>'numberTemplate' as numero,
             "bankAccountName"
      FROM invoices 
      WHERE store = 'pasto' 
      LIMIT 5
    `);
    
    console.log('📊 Mostrando 5 facturas de pasto:\n');
    result.rows.forEach(row => {
      console.log(`ID: ${row.id}`);
      console.log(`Store: ${row.store}`);
      console.log(`Número: ${row.numero}`);
      console.log(`bankAccountName: ${row.bankAccountName || '❌ NULL'}`);
      console.log('---');
    });
    
    // Contar cuántas tienen bankAccountName
    const countResult = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT("bankAccountName") as con_banco,
        COUNT(*) - COUNT("bankAccountName") as sin_banco
      FROM invoices 
      WHERE store = 'pasto'
    `);
    
    console.log('\n📈 Estadísticas:');
    console.log(`Total facturas: ${countResult.rows[0].total}`);
    console.log(`Con banco: ${countResult.rows[0].con_banco}`);
    console.log(`Sin banco: ${countResult.rows[0].sin_banco}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkData();
