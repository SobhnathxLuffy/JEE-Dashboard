"use client";

// next-themes wrapper — class strategy on <html>, system-aware.
// Adds a short `theme-switching` class on <html> during flips so the chrome
// crossfades instead of hard-cutting (see globals.css .theme-switching rule).
import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <SwitchFade>{children}</SwitchFade>
    </NextThemesProvider>
  );
}

/** flicks `theme-switching` onto <html> while a theme flip repaints */
function SwitchFade({ children }: { children: React.ReactNode }) {
  const onThemeChange = React.useCallback(() => {
    const el = document.documentElement;
    el.classList.add("theme-switching");
    window.setTimeout(() => el.classList.remove("theme-switching"), 260);
  }, []);

  // next-themes has no onChange prop in v0.4 — observe the class attribute
  React.useEffect(() => {
    const el = document.documentElement;
    let prev = el.classList.contains("dark") ? "dark" : "light";
    const ob = new MutationObserver(() => {
      const now = el.classList.contains("dark") ? "dark" : "light";
      if (now !== prev) {
        prev = now;
        onThemeChange();
      }
    });
    ob.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => ob.disconnect();
  }, [onThemeChange]);

  return <>{children}</>;
}
