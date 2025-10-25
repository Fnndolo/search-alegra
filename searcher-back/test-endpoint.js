const axios = require('axios');

async function testEndpoint() {
  try {
    console.log('🔍 Llamando a http://127.0.0.1:3000/invoices/all?store=pasto\n');
    
    const response = await axios.get('http://127.0.0.1:3000/invoices/all?store=pasto');
    
    console.log('✅ Respuesta recibida:');
    console.log(`Total facturas: ${response.data.data.length}`);
    console.log(`Store: ${response.data.store}`);
    console.log(`Fully loaded: ${response.data.fullyLoaded}`);
    
    // Mostrar las primeras 3 facturas
    console.log('\n📄 Primeras 3 facturas:');
    response.data.data.slice(0, 3).forEach((invoice, i) => {
      console.log(`\n${i + 1}. Factura #${invoice.numberTemplate?.fullNumber || 'N/A'}`);
      console.log(`   bankAccountName: ${invoice.bankAccountName || 'NULL'}`);
      console.log(`   client: ${invoice.client?.name || 'N/A'}`);
      console.log(`   total: ${invoice.total || 0}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('El servidor no está corriendo en el puerto 3000');
    }
  }
}

testEndpoint();
