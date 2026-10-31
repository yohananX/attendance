const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const sql = fs.readFileSync(path.join(__dirname, 'supabase/migrations/20261031000000_initial_schema.sql'), 'utf8');

console.log('Applying migration...');
supabase.rpc('exec_sql', { sql }).then(r => {
  console.log(r);
}).catch(e => {
  console.error(e);
});
