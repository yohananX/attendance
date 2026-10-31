const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres@localhost:5432/postgres' });
c.connect().then(() => {
  console.log('ok');
  return c.end();
}).catch(e => {
  console.error('err');
  console.error(e.message);
});
