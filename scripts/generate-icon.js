/* Generate assets/logo.png at build time using only Node built-ins.
   Produces a 512x512 Reinnovation Homes icon (navy house with "Re"). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 512, H = 512;
const navy = [20, 42, 76];
const cream = [242, 241, 236];

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  for (let x = 0; x < W; x++) {
    const i = y * (1 + W * 4) + 1 + x * 4;

    const inCorner = (cx, cy) => {
      const dx = x - cx, dy = y - cy;
      return dx*dx + dy*dy > 60*60;
    };
    if ((x < 60 && y < 60 && inCorner(60, 60)) ||
        (x > W-60 && y < 60 && inCorner(W-60, 60)) ||
        (x < 60 && y > H-60 && inCorner(60, H-60)) ||
        (x > W-60 && y > H-60 && inCorner(W-60, H-60))) {
      raw[i]=0; raw[i+1]=0; raw[i+2]=0; raw[i+3]=0;
      continue;
    }

    let onHouse = false;
    if (y >= 280 && y <= 420) {
      if ((x >= 80 && x <= 102) || (x >= 410 && x <= 432)) onHouse = true;
      if (y >= 398 && y <= 420 && x >= 80 && x <= 432) onHouse = true;
    }
    if (x >= 80 && x <= 256) {
      const ly = 280 + (-168/176) * (x - 80);
      if (Math.abs(y - ly) <= 14) onHouse = true;
    }
    if (x >= 256 && x <= 432) {
      const ly = 112 + (168/176) * (x - 256);
      if (Math.abs(y - ly) <= 14) onHouse = true;
    }

    const tx = x - 180, ty = y - 260;
    if (tx >= 0 && tx < 160 && ty >= 0 && ty < 140) {
      let isText = false;
      if (tx >= 0 && tx <= 22 && ty >= 0 && ty <= 140) isText = true;
      if (tx >= 0 && tx <= 60 && ty >= 0 && ty <= 18) isText = true;
      if (tx >= 52 && tx <= 72 && ty >= 0 && ty <= 70) isText = true;
      if (tx >= 0 && tx <= 60 && ty >= 58 && ty <= 76) isText = true;
      if (ty >= 76 && ty <= 140 && tx >= 22 && tx <= 72) {
        if (Math.abs((tx - 22) - ((ty - 76) * 50 / 64)) <= 10) isText = true;
      }
      const ex = tx - 85, ey = ty - 40;
      if (ex >= 0 && ex < 75 && ey >= 0 && ey < 100) {
        const cx = 37, cy = 50;
        const dx = ex - cx, dy = ey - cy;
        const r2 = dx*dx + dy*dy;
        if (r2 <= 40*40 && r2 >= 22*22) isText = true;
        if (ey >= 42 && ey <= 58 && ex >= 5 && ex <= 70) isText = true;
      }
      if (isText) {
        raw[i]=navy[0]; raw[i+1]=navy[1]; raw[i+2]=navy[2]; raw[i+3]=255;
        continue;
      }
    }
    if (onHouse) {
      raw[i]=navy[0]; raw[i+1]=navy[1]; raw[i+2]=navy[2]; raw[i+3]=255;
    } else {
      raw[i]=cream[0]; raw[i+1]=cream[1]; raw[i+2]=cream[2]; raw[i+3]=255;
    }
  }
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([137,80,78,71,13,10,26,10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;

const idat = zlib.deflateSync(raw);
const iend = Buffer.alloc(0);

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', iend)
]);

const outPath = path.join(__dirname, '..', 'assets', 'logo.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log('Generated', outPath, png.length, 'bytes');
