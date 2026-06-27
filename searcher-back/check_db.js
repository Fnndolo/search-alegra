const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { getDatabaseConnectionString } = require('./config');

async function check() {
  const DATABASE_URL = getDatabaseConnectionString();

  if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL in environment');
    return;
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected to DB");

    const res = await client.query('SELECT id, username, password, role, status FROM "users"');
    console.log("Users found:", res.rows.length);
    
    for (const user of res.rows) {
      console.log(`User: ${user.username}, Role: ${user.role}, Status: ${user.status}`);
      if (user.username === 'admin' && process.env.ADMIN_TEST_PASSWORD) {
        const isMatch = await bcrypt.compare(process.env.ADMIN_TEST_PASSWORD, user.password);
        console.log(`Admin password from env match: ${isMatch}`);
      } else if (user.username === 'admin') {
        console.log('ADMIN_TEST_PASSWORD is not configured, skipping password check');
      }
    }

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

check();
