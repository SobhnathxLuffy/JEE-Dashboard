"use client";

// ─── Motion system ("Quiet Cockpit" motion layer) ────────────────────────────
// Rules (DESIGN.md): transform/opacity only, signature easing
// cubic-bezier(0.16,1,0.3,1), short durations, reduced-motion respected
// globally via <MotionConfig reducedMotion="user"> in App.tsx.
import {
  motion,
  useSpring,
  useTransform,
  type Variants,
} from "framer-motion";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Page entrance: whole view fades in with a soft rise ─────────────────────
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// ─── Staggered children: cards/lists enter in a quick cascade ────────────────
const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.06 } },
};
const staggerChild: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: EASE } },
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
// Strings pass through untouched; numbers tween with a spring. Formatters keep
// "67%" / "31/36" semantics intact while the number part animates.
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

// ─── Hover lift — cards respond to the cursor with a 2px float ───────────────
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
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// ─── Radial score ring — animated stroke draw for hero results ───────────────
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
          transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
