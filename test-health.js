const http = require('http');
http.get('http://localhost:3000/api/health', (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log(res.statusCode);
    console.log(d);
  });
}).on('error', (e) => {
  console.error(e.message);
});
