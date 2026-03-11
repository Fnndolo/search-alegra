const { Client } = require('pg');
const bcrypt = require('bcrypt');

const DATABASE_URL = "postgresql://postgres:PAGJWxTCJoOBrtehUMWNmdmkoyzMEqSz@metro.proxy.rlwy.net:34115/railway";

async function check() {
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
      if (user.username === 'admin') {
        const isMatch = await bcrypt.compare('Admin123!', user.password);
        console.log(`Password 'Admin123!' match for admin: ${isMatch}`);
      }
    }

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

check();
