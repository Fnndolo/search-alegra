// Script para registrar webhooks manualmente en Alegra
const https = require('https');

// Configuración
const WEBHOOK_BASE_URL = 'search-alegra-production-5eed.up.railway.app/webhooks';

const stores = {
  pasto: 'c21hcnR2ZW50YXMwMTZAZ21haWwuY29tOjM0ODRhODQwNzE1Yjg0MDJlYzU3',
  medellin: 'c21hcnRnYWRnZXRzbWVkZWxsaW5AZ21haWwuY29tOjdiMWZhMjJmYjNjMGJhNGExMGNh',
  armenia: 'c21hcnRnYWRnZXRzYXJtZW5pYTJAZ21haWwuY29tOmZiNTkwZTgxMGZhMGQzYzc2YWRj',
  pereira: 'c21hcnR2ZW50YXNwZXJlaXJhQGdtYWlsLmNvbToyMmI0ZWFlNDlkOWE3YjRmNjM0NA=='
};

const events = ['new-invoice', 'edit-invoice', 'new-bill', 'edit-bill'];

function registerWebhook(store, apiKeyBase64, event) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      event: event,
      url: `${WEBHOOK_BASE_URL}/${store}`
    });

    const options = {
      hostname: 'api.alegra.com',
      port: 443,
      path: '/api/v1/webhooks/subscriptions',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKeyBase64}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`✅ ${store} - ${event}: SUCCESS`);
          console.log(`   Response: ${body}`);
          resolve({ success: true, store, event, response: body });
        } else {
          console.log(`❌ ${store} - ${event}: FAILED (${res.statusCode})`);
          console.log(`   Response: ${body}`);
          reject({ success: false, store, event, status: res.statusCode, response: body });
        }
      });
    });

    req.on('error', (error) => {
      console.log(`❌ ${store} - ${event}: ERROR`);
      console.log(`   ${error.message}`);
      reject({ success: false, store, event, error: error.message });
    });

    req.write(data);
    req.end();
  });
}

async function registerAllWebhooks() {
  console.log('🚀 Iniciando registro de webhooks...\n');
  console.log(`📍 URL Base: ${WEBHOOK_BASE_URL}\n`);

  for (const [store, apiKey] of Object.entries(stores)) {
    console.log(`\n📦 Procesando tienda: ${store.toUpperCase()}`);
    console.log('─'.repeat(50));

    for (const event of events) {
      try {
        await registerWebhook(store, apiKey, event);
        // Esperar un poco entre solicitudes
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        // Continuar con el siguiente incluso si falla
      }
    }
  }

  console.log('\n\n✨ Proceso completado');
}

// Ejecutar
registerAllWebhooks().catch(console.error);
