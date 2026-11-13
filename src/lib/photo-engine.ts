export const ADJ_KEYS = ["brightness", "contrast", "saturation", "exposure", "highlights", "shadows", "temperature", "tint", "sharpness", "clarity", "vibrance", "fade", "vignette", "grain"] as const;
export type AdjKey = (typeof ADJ_KEYS)[number];
export type Adj = Record<AdjKey, number>;
export const ADJ_LABELS: Record<AdjKey, string> = {
  brightness: "Brightness", contrast: "Contrast", saturation: "Saturation", exposure: "Exposure", highlights: "Highlights", shadows: "Shadows",
  temperature: "Temperature", tint: "Tint", sharpness: "Sharpness", clarity: "Clarity", vibrance: "Vibrance", fade: "Fade", vignette: "Vignette", grain: "Grain",
};
export const ADJ_RANGE: Record<AdjKey, [number, number]> = {
  brightness: [-100, 100], contrast: [-100, 100], saturation: [-100, 100], exposure: [-100, 100], highlights: [-100, 100], shadows: [-100, 100],
  temperature: [-100, 100], tint: [-100, 100], sharpness: [0, 100], clarity: [-100, 100], vibrance: [-100, 100], fade: [0, 100], vignette: [-100, 100], grain: [0, 100],
};

export type DrawShape = "pen" | "marker" | "line" | "arrow" | "rect" | "oval" | "blur";
export type Overlay =
  | { t: "draw"; shape: DrawShape; color: string; size: number; pts: [number, number][] }
  | { t: "text"; text: string; x: number; y: number; size: number; color: string; bold: boolean; bg: boolean }
  | { t: "sticker"; e: string; x: number; y: number; size: number }
  | { t: "redeye"; x: number; y: number; r: number };

export type Crop = { x: number; y: number; w: number; h: number };
export type EditState = {
  rot: number; flipH: boolean; flipV: boolean; straighten: number; perspV: number; perspH: number;
  crop: Crop; filter: string; filterAmt: number; adj: Adj; blur: number; bgBlur: number; bgFocus: { x: number; y: number };
  frame: string; overlays: Overlay[];
};
export const zeroAdj = (): Adj => Object.fromEntries(ADJ_KEYS.map((k) => [k, 0])) as Adj;
export const defaultEdit = (): EditState => ({
  rot: 0, flipH: false, flipV: false, straighten: 0, perspV: 0, perspH: 0, crop: { x: 0, y: 0, w: 1, h: 1 },
  filter: "none", filterAmt: 100, adj: zeroAdj(), blur: 0, bgBlur: 0, bgFocus: { x: 0.5, y: 0.5 }, frame: "none", overlays: [],
});

type Preset = { name: string; group: string; adj?: Partial<Adj>; bw?: boolean; sepia?: number; tone?: { s: [number, number, number]; h: [number, number, number] } };
export const FILTERS: Record<string, Preset> = {
  none: { name: "Original", group: "Basic" },
  vivid: { name: "Vivid", group: "Basic", adj: { saturation: 32, contrast: 14, vibrance: 15 } },
  warm: { name: "Warm", group: "Basic", adj: { temperature: 30, tint: 6, saturation: 8 } },
  cool: { name: "Cool", group: "Basic", adj: { temperature: -32, saturation: 6, contrast: 6 } },
  dramatic: { name: "Dramatic", group: "Basic", adj: { contrast: 36, clarity: 32, saturation: -12, vignette: 28 } },
  vintage: { name: "Vintage", group: "Vintage", sepia: 0.45, adj: { fade: 34, contrast: -8, temperature: 18, vignette: 26, grain: 18 } },
  retro70: { name: "Retro 70s", group: "Vintage", adj: { temperature: 34, fade: 28, saturation: -8, contrast: 8, grain: 14 }, tone: { s: [0.55, 0.45, 0.35], h: [0.62, 0.52, 0.38] } },
  polaroid: { name: "Polaroid", group: "Vintage", adj: { fade: 22, contrast: 10, temperature: 14, tint: -6, saturation: -6, vignette: 12 }, tone: { s: [0.45, 0.52, 0.55], h: [0.55, 0.5, 0.42] } },
  sepia: { name: "Sepia", group: "Vintage", sepia: 1, adj: { contrast: 6 } },
  teal: { name: "Teal & Orange", group: "Cinematic", adj: { contrast: 20, saturation: -4, vignette: 20, clarity: 12 }, tone: { s: [0.35, 0.5, 0.55], h: [0.62, 0.5, 0.36] } },
  noir: { name: "Noir", group: "Cinematic", adj: { contrast: 28, shadows: -20, vignette: 38, grain: 24, saturation: -55 } },
  moody: { name: "Moody", group: "Cinematic", adj: { contrast: 16, saturation: -18, shadows: -14, temperature: -10, vignette: 24, fade: 10 } },
  bw: { name: "B&W", group: "Black & white", bw: true },
  bwHigh: { name: "High-contrast B&W", group: "Black & white", bw: true, adj: { contrast: 42, clarity: 24 } },
  silver: { name: "Silver", group: "Black & white", bw: true, adj: { fade: 18, contrast: 8, brightness: 4 } },
  portraitSoft: { name: "Soft Portrait", group: "Portrait", adj: { brightness: 6, contrast: -8, clarity: -22, saturation: -4, temperature: 8, vibrance: 10 } },
  portraitGlow: { name: "Glow", group: "Portrait", adj: { brightness: 8, shadows: 24, highlights: -10, clarity: -14, temperature: 12, fade: 8 } },
  portraitPro: { name: "Studio", group: "Portrait", adj: { vibrance: 22, shadows: 18, clarity: 12, contrast: 8, sharpness: 22 } },
};

function effective(st: EditState) {
  const e = { ...st.adj };
  const p = FILTERS[st.filter];
  const k = st.filterAmt / 100;
  if (p?.adj) for (const key of Object.keys(p.adj) as AdjKey[]) e[key] += (p.adj[key] ?? 0) * k;
  return { e, bw: p?.bw ? k : 0, sepia: (p?.sepia ?? 0) * k, tone: p?.tone, toneAmt: k };
}

function blurCopy(src: HTMLCanvasElement, k: number) {
  const sm = document.createElement("canvas");
  sm.width = Math.max(1, Math.round(src.width / k)); sm.height = Math.max(1, Math.round(src.height / k));
  const x = sm.getContext("2d")!; x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, sm.width, sm.height);
  const big = document.createElement("canvas"); big.width = src.width; big.height = src.height;
  const y = big.getContext("2d", { willReadFrequently: true })!; y.imageSmoothingQuality = "high"; y.drawImage(sm, 0, 0, big.width, big.height);
  const d = y.getImageData(0, 0, big.width, big.height).data;
  sm.width = sm.height = 0; big.width = big.height = 0;
  return d;
}

function pixelPass(c: HTMLCanvasElement, st: EditState) {
  const { e, bw, sepia, tone, toneAmt } = effective(st);
  const noop = ADJ_KEYS.every((k) => Math.abs(e[k]) < 0.01) && !bw && !sepia && !tone;
  if (noop) return;
  const w = c.width, h = c.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const id = ctx.getImageData(0, 0, w, h);
  const px = id.data;
  const long = Math.max(w, h);
  const bs = e.sharpness > 0.5 ? blurCopy(c, Math.max(2, Math.round(long / 800))) : null;
  const bc = Math.abs(e.clarity) > 0.5 ? blurCopy(c, Math.max(6, Math.round(long / 90))) : null;
  const expo = Math.pow(2, (e.exposure / 100) * 1.5);
  const bri = (e.brightness / 100) * 0.3;
  const cf = e.contrast >= 0 ? 1 + (e.contrast / 100) * 0.9 : 1 + (e.contrast / 100) * 0.9;
  const sat = 1 + e.saturation / 100;
  const vib = e.vibrance / 100;
  const dr = (e.temperature / 100) * 0.14 + (e.tint / 100) * 0.04, db = -(e.temperature / 100) * 0.14 + (e.tint / 100) * 0.04, dg = -(e.tint / 100) * 0.1;
  const sh = e.shadows / 100, hi = e.highlights / 100;
  const fade = e.fade / 100, vg = e.vignette / 100, gr = (e.grain / 100) * 0.16;
  const sa = (e.sharpness / 100) * 1.4, ca = (e.clarity / 100) * 1.0;
  const cx = w / 2, cy = h / 2, maxd2 = cx * cx + cy * cy;
  let seed = 123456789;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    let r = (px[i] / 255) * expo + bri + dr, g = (px[i + 1] / 255) * expo + bri + dg, b = (px[i + 2] / 255) * expo + bri + db;
    if (sh || hi) {
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      const cl = L < 0 ? 0 : L > 1 ? 1 : L;
      const a = sh * (1 - cl) * (1 - cl) * 0.45 + hi * cl * cl * 0.45;
      r += a; g += a; b += a;
    }
    r = (r - 0.5) * cf + 0.5; g = (g - 0.5) * cf + 0.5; b = (b - 0.5) * cf + 0.5;
    if (bc) {
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      const m = 1 - Math.abs(2 * Math.min(1, Math.max(0, L)) - 1);
      const k = ca * m;
      r += (r - bc[i] / 255) * k; g += (g - bc[i + 1] / 255) * k; b += (b - bc[i + 2] / 255) * k;
    }
    if (bs) { r += (r - bs[i] / 255) * sa; g += (g - bs[i + 1] / 255) * sa; b += (b - bs[i + 2] / 255) * sa; }
    const L2 = 0.299 * r + 0.587 * g + 0.114 * b;
    if (sat !== 1 || vib) {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const f = Math.max(0, sat) * (1 + vib * (1 - Math.min(1, mx - mn)));
      r = L2 + (r - L2) * f; g = L2 + (g - L2) * f; b = L2 + (b - L2) * f;
    }
    if (bw) { r += (L2 - r) * bw; g += (L2 - g) * bw; b += (L2 - b) * bw; }
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b, sg = 0.349 * r + 0.686 * g + 0.168 * b, sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia; g += (sg - g) * sepia; b += (sb - b) * sepia;
    }
    if (tone) {
      const t = Math.min(1, Math.max(0, L2));
      const tr = tone.s[0] + (tone.h[0] - tone.s[0]) * t, tg = tone.s[1] + (tone.h[1] - tone.s[1]) * t, tb = tone.s[2] + (tone.h[2] - tone.s[2]) * t;
      r += (tr - 0.5) * 0.55 * toneAmt; g += (tg - 0.5) * 0.55 * toneAmt; b += (tb - 0.5) * 0.55 * toneAmt;
    }
    if (fade) { r = r * (1 - fade * 0.3) + fade * 0.12; g = g * (1 - fade * 0.3) + fade * 0.12; b = b * (1 - fade * 0.3) + fade * 0.12; }
    if (vg) {
      const x = (p % w) - cx, y = ((p / w) | 0) - cy;
      const d = (x * x + y * y) / maxd2;
      const f = 1 - vg * d * 1.25;
      if (vg > 0) { r *= f; g *= f; b *= f; } else { const l = -vg * d * 0.5; r += l; g += l; b += l; }
    }
    if (gr) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const n = (((seed >>> 0) % 1000) / 1000 - 0.5) * gr;
      r += n; g += n; b += n;
    }
    px[i] = r < 0 ? 0 : r > 1 ? 255 : r * 255; px[i + 1] = g < 0 ? 0 : g > 1 ? 255 : g * 255; px[i + 2] = b < 0 ? 0 : b > 1 ? 255 : b * 255;
  }
  ctx.putImageData(id, 0, 0);
}

export type RenderOpts = { maxDim: number; ignoreCrop?: boolean };

/** geometry + tone pipeline (everything except drawn overlays and frames) */
export function renderBase(src: CanvasImageSource, sw: number, sh: number, st: EditState, o: RenderOpts) {
  const odd = st.rot % 180 !== 0;
  const rw = odd ? sh : sw, rh = odd ? sw : sh;
  const crop = o.ignoreCrop ? { x: 0, y: 0, w: 1, h: 1 } : st.crop;
  const f = Math.min(1, o.maxDim / Math.max(rw * crop.w, rh * crop.h));
  const Gw = Math.max(1, Math.round(rw * f)), Gh = Math.max(1, Math.round(rh * f));
  let G = document.createElement("canvas");
  G.width = Gw; G.height = Gh;
  {
    const x = G.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    const th = (Math.abs(st.straighten) * Math.PI) / 180;
    const z = Math.cos(th) + Math.sin(th) * Math.max(Gw / Gh, Gh / Gw);
    x.translate(Gw / 2, Gh / 2);
    x.scale(st.flipH ? -1 : 1, st.flipV ? -1 : 1);
    x.rotate((st.straighten * Math.PI) / 180);
    x.scale(z, z);
    x.rotate((st.rot * Math.PI) / 180);
    x.drawImage(src, (-sw * f) / 2, (-sh * f) / 2, sw * f, sh * f);
  }
  if (st.perspV || st.perspH) {
    const P = document.createElement("canvas"); P.width = Gw; P.height = Gh;
    const x = P.getContext("2d")!;
    const kv = (st.perspV / 100) * 0.35, kh = (st.perspH / 100) * 0.35;
    let cur: HTMLCanvasElement = G;
    if (kv) {
      for (let y = 0; y < Gh; y++) {
        const s = (1 + kv * ((2 * y) / Gh - 1)) / (1 - Math.abs(kv));
        x.drawImage(cur, 0, y, Gw, 1, Gw / 2 - (Gw * s) / 2, y, Gw * s, 1);
      }
      cur = P;
    }
    if (kh) {
      const Q = document.createElement("canvas"); Q.width = Gw; Q.height = Gh;
      const qx = Q.getContext("2d")!;
      for (let xx = 0; xx < Gw; xx++) {
        const s = (1 + kh * ((2 * xx) / Gw - 1)) / (1 - Math.abs(kh));
        qx.drawImage(cur, xx, 0, 1, Gh, xx, Gh / 2 - (Gh * s) / 2, 1, Gh * s);
      }
      G.width = G.height = 0; G = Q;
      if (cur === P) { P.width = P.height = 0; }
    } else { G.width = G.height = 0; G = P; }
  }
  const cw = Math.max(1, Math.round(Gw * crop.w)), ch = Math.max(1, Math.round(Gh * crop.h));
  const C = document.createElement("canvas"); C.width = cw; C.height = ch;
  C.getContext("2d")!.drawImage(G, Math.round(Gw * crop.x), Math.round(Gh * crop.y), cw, ch, 0, 0, cw, ch);
  G.width = G.height = 0;
  pixelPass(C, st);

  // global blur / background blur (focus ellipse stays sharp)
  if (st.blur > 0 || st.bgBlur > 0) {
    const px = Math.max(cw, ch) / 600;
    const out = document.createElement("canvas"); out.width = cw; out.height = ch;
    const x = out.getContext("2d")!;
    const amount = st.blur > 0 ? st.blur : st.bgBlur;
    x.filter = `blur(${(amount / 100) * 14 * px}px)`;
    x.drawImage(C, 0, 0);
    x.filter = "none";
    if (st.blur === 0 && st.bgBlur > 0) {
      const m = document.createElement("canvas"); m.width = cw; m.height = ch;
      const mx = m.getContext("2d")!;
      mx.drawImage(C, 0, 0);
      mx.globalCompositeOperation = "destination-in";
      const fx = st.bgFocus.x * cw, fy = st.bgFocus.y * ch, rr = Math.min(cw, ch) * 0.34;
      mx.translate(fx, fy); mx.scale(1.25, 1);
      const gr = mx.createRadialGradient(0, 0, rr * 0.55, 0, 0, rr * 1.15);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      mx.fillStyle = gr; mx.fillRect(-cw, -ch, cw * 3, ch * 3);
      x.drawImage(m, 0, 0);
      m.width = m.height = 0;
    }
    C.width = cw; C.getContext("2d")!.drawImage(out, 0, 0);
    out.width = out.height = 0;
  }
  // red-eye
  const reds = st.overlays.filter((v): v is Extract<Overlay, { t: "redeye" }> => v.t === "redeye");
  if (reds.length) {
    const ctx = C.getContext("2d", { willReadFrequently: true })!;
    for (const r of reds) {
      const rad = Math.max(3, r.r * Math.min(cw, ch)), x0 = Math.max(0, Math.floor(r.x * cw - rad)), y0 = Math.max(0, Math.floor(r.y * ch - rad));
      const w2 = Math.min(cw - x0, Math.ceil(rad * 2)), h2 = Math.min(ch - y0, Math.ceil(rad * 2));
      if (w2 <= 0 || h2 <= 0) continue;
      const d = ctx.getImageData(x0, y0, w2, h2);
      for (let j = 0; j < h2; j++) for (let i = 0; i < w2; i++) {
        const dist = Math.hypot(x0 + i - r.x * cw, y0 + j - r.y * ch);
        if (dist > rad) continue;
        const o = (j * w2 + i) * 4, R = d.data[o], G2 = d.data[o + 1], B = d.data[o + 2];
        if (R > 60 && R > (G2 + B) * 0.75) { const v = Math.min(G2, B) * 0.85; d.data[o] = v; d.data[o + 1] = G2 * 0.9; d.data[o + 2] = B * 0.9; }
      }
      ctx.putImageData(d, 0, 0);
    }
  }
  return C;
}

function drawShape(x: CanvasRenderingContext2D, o: Extract<Overlay, { t: "draw" }>, W: number, H: number) {
  const m = Math.min(W, H);
  x.save();
  x.lineCap = "round"; x.lineJoin = "round";
  x.strokeStyle = o.color; x.fillStyle = o.color;
  x.lineWidth = Math.max(1, o.size * m * (o.shape === "marker" ? 2.6 : 1));
  if (o.shape === "marker") x.globalAlpha = 0.38;
  const P = o.pts.map(([a, b]) => [a * W, b * H]);
  if (!P.length) { x.restore(); return; }
  if (o.shape === "pen" || o.shape === "marker" || o.shape === "blur") {
    x.beginPath(); x.moveTo(P[0][0], P[0][1]);
    if (P.length === 1) x.lineTo(P[0][0] + 0.1, P[0][1]);
    for (let i = 1; i < P.length; i++) x.lineTo(P[i][0], P[i][1]);
    x.stroke();
  } else {
    const [a, b] = [P[0], P[P.length - 1]];
    if (o.shape === "line" || o.shape === "arrow") {
      x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      if (o.shape === "arrow") {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = Math.max(12, x.lineWidth * 4);
        x.beginPath(); x.moveTo(b[0], b[1]);
        x.lineTo(b[0] - hl * Math.cos(ang - 0.5), b[1] - hl * Math.sin(ang - 0.5)); x.moveTo(b[0], b[1]);
        x.lineTo(b[0] - hl * Math.cos(ang + 0.5), b[1] - hl * Math.sin(ang + 0.5)); x.stroke();
      }
    } else if (o.shape === "rect") x.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    else if (o.shape === "oval") { x.beginPath(); x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 || 1, Math.abs(b[1] - a[1]) / 2 || 1, 0, 0, Math.PI * 2); x.stroke(); }
  }
  x.restore();
}

export const FRAMES: Record<string, string> = { none: "None", white: "White border", black: "Black border", polaroid: "Polaroid", film: "Film strip", rounded: "Rounded", gold: "Gold" };

/** draws overlays + frame on a copy of the base canvas */
export function composite(base: HTMLCanvasElement, st: EditState, live?: Overlay | null) {
  const W = base.width, H = base.height, m = Math.min(W, H);
  const list = live ? [...st.overlays, live] : st.overlays;
  const frame = st.frame;
  let mx = 0, mt = 0, mb = 0;
  if (frame === "white" || frame === "black" || frame === "gold") mx = mt = mb = Math.round(m * 0.045);
  if (frame === "polaroid") { mx = mt = Math.round(m * 0.05); mb = Math.round(m * 0.18); }
  if (frame === "film") { mt = mb = Math.round(H * 0.08); }
  const out = document.createElement("canvas");
  out.width = W + mx * 2; out.height = H + mt + mb;
  const x = out.getContext("2d")!;
  if (frame !== "none") {
    x.fillStyle = frame === "black" || frame === "film" ? "#0b0b0b" : frame === "gold" ? "#c9a24b" : "#fafafa";
    x.fillRect(0, 0, out.width, out.height);
    if (frame === "gold") { x.strokeStyle = "#7a5a14"; x.lineWidth = Math.max(1, m * 0.006); x.strokeRect(mx / 2, mt / 2, out.width - mx, out.height - mt); }
    if (frame === "film") { x.fillStyle = "#e9e9e9"; const n = Math.round(W / (mt * 1.1)); for (let i = 0; i < n; i++) { const px = (i + 0.5) * (W / n) - mt * 0.18; x.fillRect(px, mt * 0.3, mt * 0.36, mt * 0.4); x.fillRect(px, H + mt + mt * 0.3, mt * 0.36, mt * 0.4); } }
  }
  x.save();
  x.translate(mx, mt);
  if (frame === "rounded") { const r = m * 0.07; x.beginPath(); x.roundRect(0, 0, W, H, r); x.clip(); }
  x.drawImage(base, 0, 0);
  // blur brush strokes (privacy blur)
  const blurs = list.filter((o): o is Extract<Overlay, { t: "draw" }> => o.t === "draw" && o.shape === "blur");
  if (blurs.length) {
    const bl = document.createElement("canvas"); bl.width = W; bl.height = H;
    const bx = bl.getContext("2d")!;
    bx.filter = `blur(${Math.max(4, m / 45)}px)`; bx.drawImage(base, 0, 0); bx.filter = "none";
    const mask = document.createElement("canvas"); mask.width = W; mask.height = H;
    const mk = mask.getContext("2d")!;
    for (const b of blurs) drawShape(mk, { ...b, color: "#000", size: b.size * 2.2 }, W, H);
    bx.globalCompositeOperation = "destination-in"; bx.drawImage(mask, 0, 0);
    x.drawImage(bl, 0, 0);
    bl.width = bl.height = mask.width = mask.height = 0;
  }
  for (const o of list) {
    if (o.t === "draw" && o.shape !== "blur") drawShape(x, o, W, H);
    else if (o.t === "text") {
      const fs = o.size * H;
      x.font = `${o.bold ? 800 : 500} ${fs}px ui-rounded, system-ui, sans-serif`;
      x.textAlign = "center"; x.textBaseline = "middle";
      const lines = o.text.split("\n");
      lines.forEach((ln, i) => {
        const yy = o.y * H + (i - (lines.length - 1) / 2) * fs * 1.15;
        if (o.bg) { const tw = x.measureText(ln).width; x.fillStyle = "rgba(0,0,0,.5)"; x.beginPath(); x.roundRect(o.x * W - tw / 2 - fs * 0.3, yy - fs * 0.6, tw + fs * 0.6, fs * 1.2, fs * 0.3); x.fill(); }
        x.lineWidth = fs * 0.08; x.strokeStyle = "rgba(0,0,0,.35)"; x.lineJoin = "round"; x.strokeText(ln, o.x * W, yy);
        x.fillStyle = o.color; x.fillText(ln, o.x * W, yy);
      });
    } else if (o.t === "sticker") {
      x.font = `${o.size * H}px "Apple Color Emoji","Noto Color Emoji",sans-serif`;
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(o.e, o.x * W, o.y * H);
    }
  }
  x.restore();
  return out;
}

/** a renderBase() cache key: everything except drawn overlays/frame (red-eye affects base) */
export function baseKey(st: EditState, ignoreCrop: boolean) {
  return JSON.stringify([st.rot, st.flipH, st.flipV, st.straighten, st.perspV, st.perspH, ignoreCrop ? 0 : st.crop, st.filter, st.filterAmt, st.adj, st.blur, st.bgBlur, st.bgFocus, st.overlays.filter((o) => o.t === "redeye")]);
}
