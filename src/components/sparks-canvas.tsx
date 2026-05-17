"use client";

import { useEffect, useRef } from "react";

export function SparksCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const N = 24;
    const ps = Array.from({ length: N }, () => ({
      x: Math.random() * canvas.width,
      y: canvas.height + Math.random() * 200,
      vy: -(0.2 + Math.random() * 0.8) * dpr,
      vx: (Math.random() - 0.5) * 0.2 * dpr,
      r: (0.5 + Math.random() * 1.5) * dpr,
      life: Math.random(),
    }));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;
        p.life += 0.003;
        if (p.y < -10 || p.life > 1) {
          p.x = Math.random() * canvas.width;
          p.y = canvas.height + 20;
          p.life = 0;
        }
        const a = Math.sin(p.life * Math.PI) * 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(236, 106, 29, ${a})`;
        ctx.shadowColor = "rgba(236, 106, 29, 0.5)";
        ctx.shadowBlur = 10;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas id="sparks" ref={ref} />;
}
