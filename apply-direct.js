const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg');

const conn = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!conn) {
  console.error('No DATABASE_URL or SUPABASE_DB_URL found');
  process.exit(1);
}

const sql = fs.readFileSync('supabase/migrations/20261031000000_initial_schema.sql', 'utf8');
const client = new Client({ connectionString: conn });
client.connect().then(() => {
  console.log('connected');
  return client.query(sql);
}).then(r => {
  console.log('done');
  return client.end();
}).catch(e => {
  console.error('ERR', e.message);
  process.exit(1);
});
