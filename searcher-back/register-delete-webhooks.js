/**
 * Script para registrar webhooks de DELETE en Alegra
 * Solo registra los eventos delete-invoice y delete-bill para las 4 tiendas
 */

const credentials = {
  pasto: {
    apiKey: 'smartventas016@gmail.com:3484a840715b8402ec57',
  },
  medellin: {
    apiKey: 'smartgadgetsmedellin@gmail.com:7b1fa22fb3c0ba4a10ca',
  },
  armenia: {
    apiKey: 'smartgadgetsarmenia2@gmail.com:fb590e810fa0d3c76adc',
  },
  pereira: {
    apiKey: 'smartventaspereira@gmail.com:22b4eae49d9a7b4f6344',
  }
};

const WEBHOOK_BASE_URL = 'search-alegra-production-5eed.up.railway.app/webhooks';

// Solo eventos de delete
const deleteEvents = [
  'delete-invoice',
  'delete-bill'
];

async function registerWebhooks() {
  console.log('🔄 Iniciando registro de webhooks DELETE...\n');

  const stores = Object.keys(credentials);
  let successCount = 0;
  let errorCount = 0;

  for (const store of stores) {
    console.log(`\n📍 Procesando tienda: ${store.toUpperCase()}`);
    console.log('─'.repeat(50));

    const creds = credentials[store];
    const webhookUrl = `${WEBHOOK_BASE_URL}/${store}`;

    for (const event of deleteEvents) {
      try {
        const subscription = {
          event: event,
          url: webhookUrl
        };

        console.log(`\n  ➤ Registrando: ${event}`);
        console.log(`    URL: ${webhookUrl}`);

        const response = await fetch('https://api.alegra.com/api/v1/webhooks/subscriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${Buffer.from(creds.apiKey).toString('base64')}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(subscription)
        });

        const responseText = await response.text();

        if (response.ok) {
          const result = JSON.parse(responseText);
          console.log(`    ✅ Éxito! ID: ${result.id}`);
          successCount++;
        } else {
          console.log(`    ❌ Error ${response.status}: ${responseText}`);
          errorCount++;
        }

      } catch (error) {
        console.log(`    ❌ Error: ${error.message}`);
        errorCount++;
      }

      // Pequeña pausa entre requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log('\n📊 RESUMEN:');
  console.log(`   ✅ Registrados: ${successCount}`);
  console.log(`   ❌ Errores: ${errorCount}`);
  console.log(`   📦 Total esperado: ${stores.length * deleteEvents.length} (${stores.length} tiendas × ${deleteEvents.length} eventos)`);
  console.log('\n' + '═'.repeat(50));
}

registerWebhooks().catch(console.error);
