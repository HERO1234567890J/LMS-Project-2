const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/db');
const { schemaSql } = require('../src/schema');

async function main() {
  await query(schemaSql);
  const phone = process.env.ADMIN_PHONE || '01000000000';
  const email = process.env.ADMIN_EMAIL || 'admin@law-lms.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const hash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users (name, phone, email, password_hash, role)
     VALUES ($1,$2,$3,$4,'admin')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, password_hash = EXCLUDED.password_hash, role = 'admin'`,
    ['Platform Admin', phone, email, hash],
  );

  console.log('Seeded single admin account.');
  console.log(`email: ${email}`);
  console.log(`phone: ${phone}`);
  console.log(`password: ${password}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => pool.end());
