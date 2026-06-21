/**
 * Procedural icon generator - multi-size ICO for Windows 7 32-bit+ compatibility.
 * Sizes: 16, 32, 48, 64, 128, 256 px
 * @copyright 2026 Abdallahjawadk
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function sp(px, size, x, y, r, g, b, a) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
}
function bp(px, size, x, y, r, g, b, a) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  if (px[i+3] === 0) return;
  const k = a / 255;
  px[i] = Math.round(px[i]*(1-k)+r*k);
  px[i+1] = Math.round(px[i+1]*(1-k)+g*k);
  px[i+2] = Math.round(px[i+2]*(1-k)+b*k);
}

function drawIconLarge(size, accent) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size/2, cy = size/2, radius = size*0.46;
  const top=[0x14,0xb8,0xa6], bot=[0x08,0x91,0xb2];
  for (let y=0;y<size;y++) {
    const tg=y/(size-1);
    const br=Math.round(top[0]+(bot[0]-top[0])*tg);
    const bg=Math.round(top[1]+(bot[1]-top[1])*tg);
    const bb=Math.round(top[2]+(bot[2]-top[2])*tg);
    for (let x=0;x<size;x++) {
      const d=Math.hypot(x-cx,y-cy);
      const edge=radius-d;
      const a=edge>=1?255:edge<=0?0:Math.round(edge*255);
      if (a>0) sp(px,size,x,y,br,bg,bb,a);
    }
  }
  const bars=[{x:0.28,h:0.20},{x:0.44,h:0.32},{x:0.60,h:0.46}];
  const barW=Math.max(2,Math.round(size*0.11));
  const baseY=Math.round(size*0.73);
  for (const b of bars) {
    const x0=Math.round(size*b.x), y0=Math.round(baseY-size*b.h);
    for (let y=y0;y<baseY;y++) for (let x=x0;x<x0+barW;x++) sp(px,size,x,y,255,255,255,255);
  }
  const ct=Math.max(2,Math.round(size*0.09)), cl=Math.max(4,Math.round(size*0.27));
  const ccx=Math.round(size*0.41), ccy=Math.round(size*0.35);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const inV=Math.abs(x-ccx)<=ct/2&&Math.abs(y-ccy)<=cl/2;
    const inH=Math.abs(y-ccy)<=ct/2&&Math.abs(x-ccx)<=cl/2;
    if (inV||inH) sp(px,size,x,y,accent[0],accent[1],accent[2],255);
  }
  const gcx=size*0.34, gcy=size*0.30, gr=size*0.42;
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const d=Math.hypot(x-gcx,y-gcy);
    if (d<gr) { const a=Math.round(65*(1-d/gr)); if(a>0) bp(px,size,x,y,255,255,255,a); }
    const dr=Math.hypot(x-cx,y-cy);
    if (dr<=radius-3&&dr>=radius-5) bp(px,size,x,y,255,255,255,55);
  }
  return px;
}

function drawIconSmall(size, accent) {
  const px = Buffer.alloc(size * size * 4);
  const cx=size/2, cy=size/2, radius=size*0.47;
  const top=[0x14,0xb8,0xa6], bot=[0x08,0x91,0xb2];
  for (let y=0;y<size;y++) {
    const tg=y/(size-1);
    const br=Math.round(top[0]+(bot[0]-top[0])*tg);
    const bg=Math.round(top[1]+(bot[1]-top[1])*tg);
    const bb=Math.round(top[2]+(bot[2]-top[2])*tg);
    for (let x=0;x<size;x++) {
      const d=Math.hypot(x-cx,y-cy);
      const edge=radius-d;
      const a=edge>=1?255:edge<=0?0:Math.round(edge*255);
      if (a>0) sp(px,size,x,y,br,bg,bb,a);
    }
  }
  if (size<=16) {
    const mX=Math.round(size/2), mY1=Math.round(size*0.20);
    for (let i=0;i<Math.round(size*0.65);i++) {
      const y=Math.round(mY1+i);
      sp(px,size,Math.round(mX-1-i*0.42),y,255,255,255,255);
      sp(px,size,Math.round(mX+1+i*0.42),y,255,255,255,255);
    }
    const cbY=Math.round(size*0.55);
    for (let x=Math.round(mX-size*0.22);x<=Math.round(mX+size*0.22);x++) sp(px,size,x,cbY,255,255,255,255);
  } else {
    const bars=[{x:0.27,h:0.22},{x:0.43,h:0.34},{x:0.59,h:0.48}];
    const barW=Math.max(2,Math.round(size*0.10));
    const baseY=Math.round(size*0.76);
    for (const b of bars) {
      const x0=Math.round(size*b.x), y0=Math.round(baseY-size*b.h);
      for (let y=y0;y<baseY;y++) for (let x=x0;x<x0+barW;x++) sp(px,size,x,y,255,255,255,255);
    }
    const ct=Math.max(2,Math.round(size*0.09)), cl=Math.max(3,Math.round(size*0.22));
    const ccx=Math.round(size*0.38), ccy=Math.round(size*0.32);
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const inV=Math.abs(x-ccx)<=ct/2&&Math.abs(y-ccy)<=cl/2;
      const inH=Math.abs(y-ccy)<=ct/2&&Math.abs(x-ccx)<=cl/2;
      if (inV||inH) sp(px,size,x,y,accent[0],accent[1],accent[2],255);
    }
  }
  return px;
}

function drawIcon(size, accent) {
  return size >= 64 ? drawIconLarge(size, accent) : drawIconSmall(size, accent);
}

function encodePNG(size, rgba) {
  const chunk=(type,data)=>{
    const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
    const t=Buffer.from(type,'ascii');
    const c=Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t,data])),0);
    return Buffer.concat([len,t,data,c]);
  };
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8]=8; ihdr[9]=6;
  const raw=Buffer.alloc((size*4+1)*size);
  for (let y=0;y<size;y++) {
    raw[y*(size*4+1)]=0;
    rgba.copy(raw,y*(size*4+1)+1,y*size*4,(y+1)*size*4);
  }
  return Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}

function encodeICOMulti(entries) {
  const count=entries.length;
  const DIR=6, ENTRY=16;
  let offset=DIR+ENTRY*count;
  const ebufs=entries.map(({size,pngBuf})=>{
    const e=Buffer.alloc(16);
    e[0]=size>=256?0:size; e[1]=size>=256?0:size; e[2]=0; e[3]=0;
    e.writeUInt16LE(1,4); e.writeUInt16LE(32,6);
    e.writeUInt32LE(pngBuf.length,8); e.writeUInt32LE(offset,12);
    offset+=pngBuf.length; return e;
  });
  const hdr=Buffer.alloc(6);
  hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(count,4);
  return Buffer.concat([hdr,...ebufs,...entries.map(e=>e.pngBuf)]);
}

function encodeBMP24(w, h) {
  const rowSize=Math.floor((24*w+31)/32)*4;
  const pixels=Buffer.alloc(rowSize*h);
  const topC=[0x14,0xb8,0xa6], botC=[0x0a,0x3a,0x5c];
  for (let y=0;y<h;y++) {
    const tgF=y/(h-1);
    const r=Math.round(topC[0]+(botC[0]-topC[0])*tgF);
    const g=Math.round(topC[1]+(botC[1]-topC[1])*tgF);
    const b=Math.round(topC[2]+(botC[2]-topC[2])*tgF);
    const by=h-1-y;
    for (let x=0;x<w;x++) {
      let fr=r,fg=g,fb=b;
      if (x<4){fr=Math.min(255,r+40);fg=Math.min(255,g+40);fb=Math.min(255,b+40);}
      if (x>=w-2){fr=Math.max(0,r-20);fg=Math.max(0,g-20);fb=Math.max(0,b-20);}
      const off=by*rowSize+x*3;
      pixels[off]=fb; pixels[off+1]=fg; pixels[off+2]=fr;
    }
  }
  const barsX=[20,36,52,68,84,100,116], barsH=[35,55,80,65,45,70,50];
  const barsBaseY=Math.round(h*0.62);
  for (let bi=0;bi<barsX.length;bi++) {
    const bx=barsX[bi], bh=barsH[bi];
    for (let dy=0;dy<bh;dy++) {
      const vy=barsBaseY-dy, by=h-1-vy;
      if (by<0||by>=h) continue;
      for (let dx=0;dx<10;dx++) {
        const bxp=bx+dx; if(bxp>=w) continue;
        const a=(dx===0||dx===9)?100:200;
        const off=by*rowSize+bxp*3;
        pixels[off]=a; pixels[off+1]=a; pixels[off+2]=a;
      }
    }
  }
  const fh=Buffer.alloc(14),ih=Buffer.alloc(40);
  fh.write('BM',0,'ascii');
  fh.writeUInt32LE(14+40+pixels.length,2); fh.writeUInt32LE(14+40,10);
  ih.writeUInt32LE(40,0); ih.writeInt32LE(w,4); ih.writeInt32LE(h,8);
  ih.writeUInt16LE(1,12); ih.writeUInt16LE(24,14); ih.writeUInt32LE(pixels.length,20);
  return Buffer.concat([fh,ih,pixels]);
}

function out(rel) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

const SIZES=[16,32,48,64,128,256];
const WHITE=[255,255,255], RED=[0xef,0x44,0x44];

const mainEntries=SIZES.map(size=>({size,pngBuf:encodePNG(size,drawIcon(size,WHITE))}));
const unEntries  =SIZES.map(size=>({size,pngBuf:encodePNG(size,drawIcon(size,RED))}));

writeFileSync(out('build/icon.png'),              mainEntries.find(e=>e.size===256).pngBuf);
writeFileSync(out('build/icon.ico'),              encodeICOMulti(mainEntries));
writeFileSync(out('build/uninstall.ico'),         encodeICOMulti(unEntries));
writeFileSync(out('build/installer-sidebar.bmp'), encodeBMP24(164,314));
writeFileSync(out('electron/assets/icon.png'),    mainEntries.find(e=>e.size===256).pngBuf);
writeFileSync(out('electron/assets/icon.ico'),    encodeICOMulti(mainEntries));

console.log('Icons: build/icon.{png,ico} (16/32/48/64/128/256px), uninstall.ico, installer-sidebar.bmp, electron/assets/icon.*');