require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
s.from('events').select('event_id', { head: true, count: 'exact' }).then(r => {
  console.log(r.error ? 'ERR' : 'OK');
  console.log(r.count);
  console.log(r.error && r.error.message);
}).catch(e => {
  console.error('EXC', e.message);
});
