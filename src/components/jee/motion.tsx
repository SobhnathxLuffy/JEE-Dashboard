"use client";

// ─── Motion system ("NOVA" motion layer) ─────────────────────────────────────
// Signature: ease-out-expo cubic-bezier(0.16,1,0.3,1), transform/opacity/filter
// only, short durations, reduced-motion respected globally via
// <MotionConfig reducedMotion="user"> in App.tsx. Depth comes from blur +
// rise on entry; surfaces respond to the cursor (spotlight) before touch.
import {
  motion,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Page entrance: blur + rise — the view materialises out of the ether ────
export function PageIn({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14, filter: "blur(8px)", scale: 0.995 }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", scale: 1 }}
      transition={{ duration: 0.38, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// ─── Staggered children: cards/lists enter in a quick cascade ────────────────
const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};
const staggerChild: Variants = {
  hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.42, ease: EASE },
  },
};

export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

// ─── Count-up numerals — stats settle in instead of popping ──────────────────
export function CountUp({
  value,
  className,
  format,
}: {
  value: number;
  className?: string;
  /** render the animated number — e.g. (v) => `${Math.round(v)}%` */
  format?: (v: number) => string;
}) {
  const spring = useSpring(value, { stiffness: 90, damping: 22, mass: 0.6 });
  const text = useTransform(spring, (v) =>
    format ? format(v) : String(Math.round(v))
  );
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  return (
    <motion.span className={cn("tabular-nums", className)}>
      {text}
    </motion.span>
  );
}

// ─── Hover lift — cards respond to the cursor with a float + tilt shadow ────
export function HoverLift({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.22, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// ─── Spotlight surface — cursor-tracked radial sheen + soft lift ─────────────
// The Vercel/Linear signature: light follows the pointer across the glass.
// Pure CSS vars (--mx/--my) — no re-render per mousemove.
export function Spotlight({
  children,
  className,
  lift = true,
}: {
  children: React.ReactNode;
  className?: string;
  lift?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);
  const MotionTag = lift ? HoverLift : Passthrough;
  return (
    <MotionTag className="h-full">
      <div
        ref={ref}
        onMouseMove={onMove}
        className={cn("spotlight h-full rounded-xl", className)}
      >
        {children}
      </div>
    </MotionTag>
  );
}

function Passthrough({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

// ─── Radial score ring — animated stroke draw + light emission ───────────────
export function ScoreRing({
  percent,
  size = 88,
  strokeWidth = 7,
  color = "var(--sem-emerald)",
  trackColor = "var(--chart-grid)",
  children,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      {/* halo behind the ring — the score feels luminous */}
      <div
        aria-hidden="true"
        className="absolute inset-1 rounded-full"
        style={{ background: `radial-gradient(circle, ${color} 0%, transparent 68%)`, opacity: 0.22, filter: "blur(10px)" }}
      />
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (clamped / 100) * c }}
          transition={{ duration: 1, ease: EASE, delay: 0.15 }}
          style={{ filter: "drop-shadow(0 0 7px currentColor)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

// ─── Shimmer bar — a scanning light strip for timers/loading ─────────────────
export function Shimmer({
  className,
  gradient = "linear-gradient(90deg, oklch(0.66 0.24 292), oklch(0.8 0.12 225))",
  animated = true,
}: {
  className?: string;
  gradient?: string;
  animated?: boolean;
}) {
  return (
    <div
      className={cn("h-1 rounded-full overflow-hidden", animated && "shimmer", className)}
      style={{ background: gradient }}
    />
  );
}
