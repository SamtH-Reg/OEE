const fs = require('fs');
const { Client } = require('pg');
const url = fs.readFileSync('.env', 'utf8').split('DATABASE_URL=')[1].split('\n')[0].trim();
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const f of process.argv.slice(2)) {
    process.stdout.write('>> ' + f + ' ... ');
    try {
      await c.query(fs.readFileSync(f, 'utf8'));
      console.log('OK');
    } catch (e) {
      console.log('FALLA');
      console.log('   ', e.message);
      process.exitCode = 1;
      break;
    }
  }
  await c.end();
})();
