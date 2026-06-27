const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { getDatabaseConnectionString } = require('./config');

async function createUser({ username, email, password, role }) {
  const DATABASE_URL = getDatabaseConnectionString();
  if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL in environment');
    process.exit(1);
  }

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB');

    // Check if user already exists
    const existing = await client.query(
      'SELECT id, username FROM "users" WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      console.error(`User already exists: ${existing.rows[0].username}`);
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Password hashed ✅');

    const result = await client.query(
      `INSERT INTO "users" (username, email, password, role, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())
       RETURNING id, username, email, role, status`,
      [username, email, hashedPassword, role]
    );

    const created = result.rows[0];
    console.log('User created ✅');
    console.log(`  id:       ${created.id}`);
    console.log(`  username: ${created.username}`);
    console.log(`  email:    ${created.email}`);
    console.log(`  role:     ${created.role}`);
    console.log(`  status:   ${created.status}`);

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

createUser({
  username: 'prueba',
  email: 'prueba@prueba.com',
  password: 'Prueba123!',
  role: 'admin'
});
