import { useEffect, useRef, useState } from 'react';

// Partículas da tela Memória (D12, referência 01): pontos saem da coluna de memória usada e correm para a
// direita, em funil, na direção dos grupos. Densidade proporcional ao memLoad.
// Custo: no máximo MAX pontos, 30 quadros/s, fillRect em lotes por cor (sem arc, sem gradiente por ponto).
// Pausa com a aba escondida, com o canvas fora da tela (a aba Memória fica montada, só escondida) e ao desmontar.
// Com prefers-reduced-motion só mostra um gradiente estático.

const MAX = 600;
const FRAME_MS = 1000 / 30;
const LEVELS = 5;

const rgb = (hex: string, fallback: [number, number, number]): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export function Particles({ memLoad, anchor }: { memLoad: number; anchor?: React.RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const load = useRef(memLoad);
  load.current = memLoad;
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const el = box.current, cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (reduced || !el || !cv || !ctx) return;

    const css = getComputedStyle(document.documentElement);
    const fg = rgb(css.getPropertyValue('--fg'), [237, 235, 229]);
    const accent = rgb(css.getPropertyValue('--accent'), [189, 254, 58]);
    const styles = [fg, accent].flatMap(([r, g, b]) =>
      Array.from({ length: LEVELS }, (_, l) => `rgba(${r},${g},${b},${(((l + 1) / LEVELS) * 0.85).toFixed(2)})`));

    // estado das partículas em arrays tipados (nada de objetos por ponto)
    const prog = new Float32Array(MAX), spd = new Float32Array(MAX), off = new Float32Array(MAX);
    const phase = new Float32Array(MAX), px = new Float32Array(MAX), warm = new Uint8Array(MAX);
    const key = new Uint8Array(MAX), px0 = new Float32Array(MAX), py = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) {
      prog[i] = Math.random(); spd[i] = 0.1 + Math.random() * 0.2; off[i] = Math.random();
      phase[i] = Math.random() * 6.283; px[i] = Math.random() < 0.6 ? 1.3 : 2; warm[i] = Math.random() < 0.7 ? 1 : 0;
    }

    let w = 0, h = 0, dpr = 1;
    let ox = 0, top = 0, bottom = 0, ty = 0;   // origem em x, faixa da barra e ponto onde o funil converge
    let shown = load.current;
    let prevN = 0;

    function measure() {
      const r = el!.getBoundingClientRect();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      dpr = window.devicePixelRatio || 1;
      cv!.width = Math.round(w * dpr); cv!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const a = anchor?.current?.getBoundingClientRect();
      if (a) { ox = a.right - r.left + 3; top = a.top - r.top; bottom = a.bottom - r.top; }
      else { ox = w * 0.3; top = 0; bottom = h; }
      ty = top + (bottom - top) * 0.4;
    }

    function frame(dt: number) {
      shown += (load.current - shown) * Math.min(1, dt * 2);
      const ml = Math.min(100, Math.max(0, shown)) / 100;
      const n = Math.round(MAX * ml);
      for (let i = prevN; i < n; i++) prog[i] = 0;   // pontos novos nascem na barra
      prevN = n;
      const used = (bottom - top) * ml, y0 = bottom - used, span = w - ox;
      ctx!.clearRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        let p = prog[i]! + spd[i]! * dt;
        if (p >= 1) { p = 0; off[i] = Math.random(); spd[i] = 0.1 + Math.random() * 0.2; }
        prog[i] = p;
        const e = p * p * (3 - 2 * p);                       // smoothstep: sai devagar, converge no meio
        const startY = y0 + off[i]! * used;
        const wob = Math.sin(phase[i]! + p * 9) * 7 * (1 - p * 0.7);
        px0[i] = ox + span * (0.5 * p + 0.5 * e);
        py[i] = startY + (ty - startY) * e + wob;
        const a = Math.min(1, p * 10) * (1 - p) ** 0.6;   // nasce rápido na barra e some perto dos grupos
        const lvl = Math.min(LEVELS - 1, Math.floor(a * LEVELS));
        key[i] = (warm[i] && p < 0.4 ? LEVELS : 0) + lvl;    // pontos perto da barra puxam para o --accent
      }
      for (let k = 0; k < styles.length; k++) {
        ctx!.fillStyle = styles[k]!;
        for (let i = 0; i < n; i++) if (key[i] === k) ctx!.fillRect(px0[i]!, py[i]!, px[i]!, px[i]!);
      }
    }

    let raf = 0, last = 0, inView = true;
    const running = () => !document.hidden && inView;
    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      const d = now - last;
      if (d < FRAME_MS) return;
      last = now;
      frame(Math.min(0.1, d / 1000));
    }
    function sync() {
      if (running() && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
      else if (!running() && raf) { cancelAnimationFrame(raf); raf = 0; }
    }

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (anchor?.current) ro.observe(anchor.current);
    const io = new IntersectionObserver(([e]) => { inView = !!e?.isIntersecting; sync(); });
    io.observe(el);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('resize', measure);   // devicePixelRatio muda ao mover a janela entre telas
    sync();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', measure);
    };
  }, [reduced, anchor]);

  return (
    <div ref={box} className={`particles${reduced ? ' particles-still' : ''}`} aria-hidden="true">
      {!reduced && <canvas ref={canvas} />}
    </div>
  );
}
