const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const vendor = path.join(__dirname, 'vendor');
const cache = path.join(vendor, 'cache');
fs.mkdirSync(cache, { recursive: true });

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} завершился с кодом ${result.status}`);
  }
}

function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    console.log('уже скачан', path.basename(dest));
    return;
  }
  console.log('скачиваю', url);
  const part = `${dest}.part`;
  run('curl.exe', ['-L', '--fail', '--retry', '3', '-o', part, url]);
  fs.renameSync(part, dest);
}

function extract(zip, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  run('tar.exe', ['-xf', zip, '-C', dest]);
}

function moveChild(extracted, target) {
  const entries = fs.readdirSync(extracted);
  const only = entries.length === 1 ? path.join(extracted, entries[0]) : extracted;
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(only, target);
}

async function nodeVersion() {
  const res = await fetch('https://nodejs.org/dist/index.json');
  if (!res.ok) throw new Error(`nodejs.org ${res.status}`);
  const list = await res.json();
  const lts = list.find((item) => item.lts && String(item.version).startsWith('v22.'));
  if (!lts) throw new Error('Не найден Node.js 22 LTS');
  return lts.version;
}

async function main() {
  const version = await nodeVersion();
  const nodeExe = path.join(vendor, 'node', 'node.exe');
  if (!fs.existsSync(nodeExe)) {
    const zip = path.join(cache, `node-${version}-win-x64.zip`);
    download(`https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`, zip);
    extract(zip, path.join(cache, 'node-extract'));
    moveChild(path.join(cache, 'node-extract'), path.join(vendor, 'node'));
  } else {
    console.log('node уже на месте');
  }

  const pgExe = path.join(vendor, 'pgsql', 'bin', 'postgres.exe');
  if (!fs.existsSync(pgExe)) {
    const zip = path.join(cache, 'postgresql-16.15-5-windows-x64-binaries.zip');
    download('https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip', zip);
    extract(zip, path.join(cache, 'pg-extract'));
    const extracted = path.join(cache, 'pg-extract');
    const nested = path.join(extracted, 'pgsql');
    fs.rmSync(path.join(vendor, 'pgsql'), { recursive: true, force: true });
    fs.renameSync(fs.existsSync(nested) ? nested : extracted, path.join(vendor, 'pgsql'));
    for (const name of ['doc', 'include', 'symbols', 'pgAdmin 4']) {
      fs.rmSync(path.join(vendor, 'pgsql', name), { recursive: true, force: true });
    }
  } else {
    console.log('postgres уже на месте');
  }

  const redisExe = path.join(vendor, 'redis', 'redis-server.exe');
  if (!fs.existsSync(redisExe)) {
    const zip = path.join(cache, 'Redis-x64-5.0.14.1.zip');
    download('https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip', zip);
    extract(zip, path.join(cache, 'redis-extract'));
    const found = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.toLowerCase() === 'redis-server.exe') found.push(full);
      }
    };
    walk(path.join(cache, 'redis-extract'));
    if (!found[0]) throw new Error('В архиве Redis нет redis-server.exe');
    fs.mkdirSync(path.join(vendor, 'redis'), { recursive: true });
    const fromDir = path.dirname(found[0]);
    for (const name of fs.readdirSync(fromDir)) {
      const src = path.join(fromDir, name);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(vendor, 'redis', name));
    }
  } else {
    console.log('redis уже на месте');
  }

  const ffmpegExe = path.join(vendor, 'ffmpeg', 'ffmpeg.exe');
  if (!fs.existsSync(ffmpegExe)) {
    const zip = path.join(cache, 'ffmpeg-win64-gpl.zip');
    download('https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', zip);
    extract(zip, path.join(cache, 'ffmpeg-extract'));
    const found = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.toLowerCase() === 'ffmpeg.exe') found.push(full);
      }
    };
    walk(path.join(cache, 'ffmpeg-extract'));
    if (!found[0]) throw new Error('В архиве ffmpeg нет ffmpeg.exe');
    fs.mkdirSync(path.join(vendor, 'ffmpeg'), { recursive: true });
    const fromDir = path.dirname(found[0]);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = path.join(fromDir, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(vendor, 'ffmpeg', name));
    }
  } else {
    console.log('ffmpeg уже на месте');
  }

  const ytdlp = path.join(vendor, 'yt-dlp.exe');
  if (!fs.existsSync(ytdlp)) {
    download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', ytdlp);
  } else {
    console.log('yt-dlp уже на месте');
  }

  console.log('компоненты готовы');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
