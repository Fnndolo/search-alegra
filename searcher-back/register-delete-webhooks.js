/**
 * Script para registrar webhooks de DELETE en Alegra
 * Solo registra los eventos delete-invoice y delete-bill para las 4 tiendas
 */

const { getStoreApiKey, getWebhookBaseUrl } = require('./config');

const credentials = {
  pasto: {
    apiKey: getStoreApiKey('pasto'),
  },
  medellin: {
    apiKey: getStoreApiKey('medellin'),
  },
  armenia: {
    apiKey: getStoreApiKey('armenia'),
  },
  pereira: {
    apiKey: getStoreApiKey('pereira'),
  }
};

const WEBHOOK_BASE_URL = getWebhookBaseUrl();

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
    if (!WEBHOOK_BASE_URL) {
      console.log('    ❌ WEBHOOK_BASE_URL no está configurada');
      errorCount++;
      continue;
    }

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
