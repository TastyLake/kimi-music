const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const SITE = 'http://127.0.0.1:3000';
const LAN_HOST = '192.168.0.12';
const LAN_URL = `http://${LAN_HOST}:3000`;
const children = [];

function projectRoot() {
  if (process.env.LORAL_ROOT) return path.resolve(process.env.LORAL_ROOT);
  const candidates = [
    path.resolve(__dirname, '..'),
    path.resolve(path.dirname(process.execPath), '..', '..'),
    path.resolve(process.cwd(), '..'),
    process.cwd(),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'backend', 'package.json'))) ?? candidates[0];
}

const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'loral') : projectRoot();

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

function waitHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error(`Нет ответа от ${url}`));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

function vendorPath(...parts) {
  return path.join(ROOT, 'vendor', ...parts);
}

function lanAddresses() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) ips.push(item.address);
    }
  }
  return ips;
}

function childEnv(extra) {
  const env = { ...process.env, BROWSER: 'none', ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  if (app.isPackaged) {
    const nodeDir = vendorPath('node');
    const pgBin = vendorPath('pgsql', 'bin');
    const ffmpegDir = vendorPath('ffmpeg');
    env.PATH = [nodeDir, pgBin, vendorPath('pgsql', 'lib'), ffmpegDir, env.PATH].filter(Boolean).join(';');
    env.YTDLP_PATH = vendorPath('yt-dlp.exe');
    env.FFMPEG_PATH = ffmpegDir;
    const origins = ['http://127.0.0.1:3000', 'http://localhost:3000', LAN_URL, ...lanAddresses().map((ip) => `http://${ip}:3000`)];
    env.CORS_ORIGIN = [...new Set(origins)].join(',');
    env.HOST = '127.0.0.1';
  }
  return env;
}

function logPath(name) {
  const dir = app.isPackaged ? path.join(app.getPath('userData'), 'logs') : path.join(ROOT, 'desktop', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function quoteArg(arg) {
  const text = String(arg);
  if (!/[\s"&|<>^%]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function start(command, args, cwd, logName, extraEnv) {
  const log = fs.openSync(logPath(logName), 'a');
  const child = spawn(command, args.map(quoteArg), {
    cwd,
    env: childEnv(extraEnv),
    shell: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  children.push(child);
  child.on('exit', () => fs.close(log, () => undefined));
  return child;
}

function run(command, args, cwd, logName, extraEnv) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(logPath(logName), 'a');
    const child = spawn(command, args.map(quoteArg), {
      cwd,
      env: childEnv(extraEnv),
      shell: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    child.on('error', (err) => {
      fs.close(log, () => undefined);
      reject(err);
    });
    child.on('exit', (code) => {
      fs.close(log, () => undefined);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} завершился с кодом ${code}. Журнал: ${logPath(logName)}`));
    });
  });
}

let postgresData = null;

function stopChildren() {
  if (postgresData) {
    const pg = vendorPath('pgsql', 'bin', 'pg_ctl.exe');
    if (fs.existsSync(pg)) spawnSync(pg, ['stop', '-D', postgresData, '-m', 'fast', '-w'], { windowsHide: true, env: childEnv() });
    postgresData = null;
  }
  for (const child of children) {
    if (!child.pid || child.killed) continue;
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  children.length = 0;
}

function allowLan() {
  const check = spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=Loral'], { windowsHide: true, stdio: 'ignore' });
  if (check.status === 0) return;
  spawnSync(
    'netsh',
    ['advfirewall', 'firewall', 'add', 'rule', 'name=Loral', 'dir=in', 'action=allow', 'protocol=TCP', 'localport=3000'],
    { windowsHide: true, stdio: 'ignore' },
  );
}

async function startBundledInfra(setStatus) {
  const userData = app.getPath('userData');
  if (!(await portOpen(6379))) {
    setStatus('Запускаю Redis…');
    const dir = path.join(userData, 'redis');
    fs.mkdirSync(dir, { recursive: true });
    const exe = vendorPath('redis', 'redis-server.exe');
    if (!fs.existsSync(exe)) throw new Error('В установщике нет Redis');
    start(exe, ['--bind', '127.0.0.1', '--port', '6379', '--dir', dir, '--dbfilename', 'dump.rdb'], dir, 'redis.log');
  }
  if (!(await portOpen(5432))) {
    setStatus('Запускаю PostgreSQL…');
    const data = path.join(userData, 'pgdata');
    const initdb = vendorPath('pgsql', 'bin', 'initdb.exe');
    const pg = vendorPath('pgsql', 'bin', 'pg_ctl.exe');
    const psql = vendorPath('pgsql', 'bin', 'psql.exe');
    if (!fs.existsSync(initdb)) throw new Error('В установщике нет PostgreSQL');
    if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
      fs.rmSync(data, { recursive: true, force: true });
      await run(initdb, ['-D', data, '-U', 'music', '-A', 'trust', '-E', 'UTF8', '--no-locale'], userData, 'postgres.log');
    }
    fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
    await run(pg, ['start', '-D', data, '-w', '-l', path.join(userData, 'logs', 'postgres.log'), '-o', '-p 5432 -h 127.0.0.1'], userData, 'postgres-ctl.log');
    postgresData = data;
    const exists = spawnSync(psql, ['-h', '127.0.0.1', '-p', '5432', '-U', 'music', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'music'"], {
      windowsHide: true,
      env: childEnv(),
      encoding: 'utf8',
    });
    if (exists.status !== 0) throw new Error(exists.stderr || 'PostgreSQL не принимает подключения');
    if (!String(exists.stdout || '').includes('1')) {
      await run(vendorPath('pgsql', 'bin', 'createdb.exe'), ['-h', '127.0.0.1', '-p', '5432', '-U', 'music', 'music'], userData, 'postgres.log');
    }
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await portOpen(5432)) && (await portOpen(6379))) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Встроенные PostgreSQL или Redis не открыли порты 5432 и 6379');
}

function parseEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function ensureConfig() {
  const userData = app.getPath('userData');
  fs.mkdirSync(path.join(userData, 'data'), { recursive: true });
  fs.mkdirSync(path.join(userData, 'media'), { recursive: true });
  const file = path.join(userData, 'config.env');
  if (!fs.existsSync(file)) {
    const adminPassword = crypto.randomBytes(9).toString('base64url');
    const body = [
      'PORT=4000',
      `CORS_ORIGIN=http://127.0.0.1:3000,http://localhost:3000,${LAN_URL}`,
      'DATABASE_URL=postgresql://music:music@localhost:5432/music?schema=public',
      'REDIS_URL=redis://localhost:6379',
      `DATA_DIR=${path.join(userData, 'data')}`,
      `MUSIC_DIR=${path.join(userData, 'media')}`,
      `JWT_ACCESS_SECRET=${crypto.randomBytes(32).toString('hex')}`,
      `JWT_REFRESH_SECRET=${crypto.randomBytes(32).toString('hex')}`,
      'ALLOW_REGISTRATION=true',
      'ADMIN_USERNAME=admin',
      'ADMIN_EMAIL=admin@example.com',
      `ADMIN_PASSWORD=${adminPassword}`,
      'RUN_WORKER_IN_PROCESS=true',
      'SCAN_ON_START=false',
      '',
    ].join('\n');
    fs.writeFileSync(file, body);
    const note = path.join(app.getPath('desktop'), 'Loral-admin.txt');
    if (!fs.existsSync(note)) {
      fs.writeFileSync(
        note,
        `Логин: admin\nПароль: ${adminPassword}\n\nНастройки: ${file}\nМузыка и данные хранятся в:\n${userData}\nЭту папку обновление программы не удаляет.\n`,
      );
    }
  }
  return parseEnv(file);
}

async function ensureInfra(setStatus, composeDir) {
  const [db, redis] = await Promise.all([portOpen(5432), portOpen(6379)]);
  if (db && redis) return;
  setStatus('Поднимаю PostgreSQL и Redis…');
  const args = app.isPackaged ? ['compose', '-p', 'loral', '-f', path.join(composeDir, 'docker-compose.yml'), 'up', '-d'] : ['compose', 'up', '-d'];
  await run('docker', args, composeDir, 'docker.log');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if ((await portOpen(5432)) && (await portOpen(6379))) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('PostgreSQL или Redis не ответили. Установите Docker Desktop, запустите его и откройте Loral снова.');
}

async function prepareInstalled(env) {
  const userData = app.getPath('userData');
  const backend = path.join(ROOT, 'backend');
  const frontend = path.join(ROOT, 'frontend');
  const stamp = path.join(userData, 'app-version');
  const ready =
    fs.existsSync(stamp) &&
    fs.readFileSync(stamp, 'utf8').trim() === app.getVersion() &&
    fs.existsSync(path.join(backend, 'dist', 'index.js')) &&
    fs.existsSync(path.join(frontend, '.next'));
  if (!ready) {
    setStatus('Устанавливаю компоненты. При первом запуске и обновлении это занимает несколько минут…');
    fs.rmSync(path.join(backend, 'node_modules'), { recursive: true, force: true });
    fs.rmSync(path.join(frontend, 'node_modules'), { recursive: true, force: true });
    await run('npm', ['ci'], backend, 'setup-backend.log', env);
    await run('npm', ['run', 'build'], backend, 'setup-backend.log', env);
    await run('npm', ['ci'], frontend, 'setup-frontend.log', env);
    fs.writeFileSync(path.join(frontend, '.env.local'), 'BACKEND_URL=http://127.0.0.1:4000\n');
    await run('npm', ['run', 'build'], frontend, 'setup-frontend.log', env);
    fs.writeFileSync(stamp, app.getVersion());
  }
  setStatus('Проверяю базу данных…');
  await run('npx', ['prisma', 'migrate', 'deploy'], backend, 'migrate.log', env);
}

async function ensureServers(setStatus, extraEnv, production) {
  const backend = path.join(ROOT, 'backend');
  const frontend = path.join(ROOT, 'frontend');
  if (!(await portOpen(4000))) {
    setStatus('Запускаю API…');
    start('npm', [production ? 'start' : 'run', ...(production ? [] : ['dev'])], backend, 'backend.log', extraEnv);
  }
  if (!(await portOpen(3000))) {
    setStatus('Запускаю интерфейс…');
    if (production) start('npx', ['next', 'start', '-H', '0.0.0.0', '-p', '3000'], frontend, 'frontend.log', extraEnv);
    else start('npm', ['run', 'dev'], frontend, 'frontend.log', extraEnv);
  }
  setStatus('Жду, пока откроется сайт…');
  await waitHttp('http://127.0.0.1:4000/api/health', 90_000);
  await waitHttp(SITE, production ? 90_000 : 180_000);
}

let win;

function setStatus(text) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`document.getElementById('s') && (document.getElementById('s').textContent = ${JSON.stringify(text)})`).catch(() => undefined);
}

function isMainComputer() {
  return lanAddresses().includes(LAN_HOST);
}

async function boot() {
  try {
    if (app.isPackaged && !isMainComputer()) {
      setStatus('Подключаюсь к главному компьютеру…');
      try {
        await waitHttp(LAN_URL, 20_000);
      } catch {
        throw new Error(`Главный компьютер ${LAN_HOST} не отвечает. Запустите Loral на нём: база, пользователи и треки хранятся только там.`);
      }
      await win.loadURL(LAN_URL);
      return;
    }
    if (app.isPackaged) {
      const env = ensureConfig();
      allowLan();
      await startBundledInfra(setStatus);
      await prepareInstalled(env);
      await ensureServers(setStatus, env, true);
      const ips = lanAddresses();
      const note = [`Сайт для всех устройств в сети: ${LAN_URL}`, ips.length ? `Адреса этого компьютера: ${ips.join(', ')}` : 'Сетевой адрес не найден'].join('. ');
      fs.writeFileSync(path.join(app.getPath('desktop'), 'Loral-network.txt'), `${note}\n`);
      if (!ips.includes(LAN_HOST)) setStatus(`${note}. Компьютер сейчас не на ${LAN_HOST}.`);
    } else {
      await ensureInfra(setStatus, ROOT);
      await ensureServers(setStatus, undefined, false);
    }
    await win.loadURL(SITE);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    title: 'Loral',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    show: true,
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const local = url.startsWith(SITE) || url.startsWith('http://localhost:3000') || url.startsWith(LAN_URL);
    if (!local && url.startsWith('http')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  void win.loadFile(path.join(__dirname, 'loading.html')).then(() => boot());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('app.loral.desktop');
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopChildren);
}
