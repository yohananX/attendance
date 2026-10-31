const fs = require('fs');
require('dotenv').config({ path: '.env.local' });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sql = fs.readFileSync('supabase/migrations/20261031000000_initial_schema.sql', 'utf8');

fetch(url + '/pg', {
  method: 'POST',
  headers: {
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: sql })
}).then(r => r.text()).then(t => {
  console.log(t.substring(0, 300));
}).catch(e => {
  console.error('ERR', e.message);
});
