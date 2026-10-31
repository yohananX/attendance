require('dotenv').config({ path: '.env.local' });
console.log('URL:', process.env.SUPABASE_URL ? 'set' : 'no');
console.log('KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'no');
console.log('DB:', process.env.DATABASE_URL ? 'set' : 'no');
