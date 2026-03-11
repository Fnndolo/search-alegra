const { DataSource } = require('typeorm');
const path = require('path');
const db = new DataSource({
  type: 'postgres',
  url: 'postgresql://postgres:PAGJWxTCJoOBrtehUMWNmdmkoyzMEqSz@metro.proxy.rlwy.net:34115/railway',
  logging: false,
});

async function run() {
  await db.initialize();
  const res = await db.query('SELECT id, store, "billingStatus", "paymentBankAccounts" FROM invoices WHERE "billingStatus" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 5');
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

run().catch(console.error);
