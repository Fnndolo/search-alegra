const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:PAGJWxTCJoOBrtehUMWNmdmkoyzMEqSz@metro.proxy.rlwy.net:34115/railway'
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT data->>'id' as id, data->>'datetime' as datetime, "billingStatus", data->'status' as status
    FROM invoices
    WHERE store = 'pasto'
      AND (
        data->>'paymentBankAccounts' IS NULL
        OR jsonb_array_length(data->'paymentBankAccounts') = 0
        OR "paymentBankAccounts" IS NULL
        OR jsonb_array_length("paymentBankAccounts") = 0
      )
    ORDER BY CAST(data->>'id' AS INTEGER) DESC
    LIMIT 30
  `);
  console.log(res.rows);
  await client.end();
}

run().catch(console.error);
