const { pool } = require('../src/db');
const { schemaSql } = require('../src/schema');

pool.query(schemaSql)
  .then(() => {
    console.log('Migrations applied.');
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
