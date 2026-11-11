const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const APP = 'C:/Users/jhuequen/Documents/paradas-planta/app';
const LOG = path.join(APP, 'server.log');

const puertoLibre = () => new Promise((res) => {
  const s = net.connect(8787, '127.0.0.1');
  s.on('connect', () => { s.destroy(); res(false); });
  s.on('error', () => res(true));
});

(async () => {
  for (let i = 0; i < 20; i++) {
    if (await puertoLibre()) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const out = fs.openSync(LOG, 'a');
  const p = spawn(process.execPath, ['--env-file=.env', 'server/index.js'], {
    cwd: APP, detached: true, windowsHide: true, stdio: ['ignore', out, out]
  });
  p.unref();
  console.log('lanzado', p.pid);
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (!(await puertoLibre())) { console.log('escuchando en 8787'); return; }
  }
  console.log('no arrancó; ver server.log');
})();
