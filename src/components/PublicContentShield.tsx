import React, { useEffect, useState } from "react";
import { ShieldAlert, EyeOff } from "lucide-react";

interface PublicContentShieldProps {
  onLockChange?: (locked: boolean) => void;
}

/**
 * Active protection shield mounted STRICTLY on public shared property pages (isPublicShared=true).
 * - Blocks context menu, selection, copy/cut, drag, printing, and DevTools / capture shortcuts.
 * - Activates a privacy blur curtain on tab switch, window blur, or PrintScreen (never on mouseleave).
 * - Runs an active debugger trap and locks rendered canvas pixels whenever Inspect Element / DevTools is open.
 */
export const PublicContentShield: React.FC<PublicContentShieldProps> = ({ onLockChange }) => {
  const [curtainReason, setCurtainReason] = useState<"blur" | "screenshot" | "devtools" | null>(null);

  useEffect(() => {
    onLockChange?.(curtainReason !== null);
  }, [curtainReason, onLockChange]);

  useEffect(() => {
    let screenshotTimeout: number | null = null;

    const triggerScreenshotCurtain = () => {
      setCurtainReason("screenshot");
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          void navigator.clipboard.writeText("Conținut protejat - brokr.ro").catch(() => {});
        }
      } catch {
        // Ignore clipboard errors when unpermitted
      }
      if (screenshotTimeout) window.clearTimeout(screenshotTimeout);
      screenshotTimeout = window.setTimeout(() => {
        setCurtainReason((prev) => (prev === "screenshot" ? null : prev));
      }, 2600);
    };

    const preventDefault = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // PrintScreen key detection
      if (e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44) {
        e.preventDefault();
        e.stopPropagation();
        triggerScreenshotCurtain();
        return;
      }

      // macOS screenshot shortcuts (Cmd+Shift+3/4/5)
      if (e.metaKey && e.shiftKey && (key === "3" || key === "4" || key === "5" || key === "s")) {
        e.preventDefault();
        e.stopPropagation();
        triggerScreenshotCurtain();
        return;
      }

      // Windows Snipping Tool shortcut (Meta+Shift+S) or Ctrl+P / Ctrl+S / Ctrl+C / Ctrl+A / Ctrl+U
      if (ctrlOrMeta && (key === "p" || key === "s" || key === "u" || key === "c" || key === "x" || key === "a")) {
        e.preventDefault();
        e.stopPropagation();
        if (key === "p") {
          triggerScreenshotCurtain();
        }
        return;
      }

      // DevTools shortcuts: F12, Ctrl/Cmd+Shift+I/J/C/K, Cmd+Option+I/J/C/U
      if (
        e.key === "F12" ||
        (ctrlOrMeta && e.shiftKey && (key === "i" || key === "j" || key === "c" || key === "k")) ||
        (e.metaKey && e.altKey && (key === "i" || key === "j" || key === "c" || key === "u"))
      ) {
        e.preventDefault();
        e.stopPropagation();
        setCurtainReason("devtools");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44) {
        triggerScreenshotCurtain();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === "hidden") {
        setCurtainReason((prev) => (prev === "devtools" ? prev : "blur"));
      } else {
        setCurtainReason((prev) => (prev === "blur" ? null : prev));
      }
    };

    const handleWindowBlur = () => {
      setCurtainReason((prev) => (prev === "devtools" ? prev : "blur"));
    };

    const handleWindowFocus = () => {
      setCurtainReason((prev) => (prev === "blur" ? null : prev));
    };

    const handleBeforePrint = (e: Event) => {
      e.preventDefault();
      triggerScreenshotCurtain();
    };

    // Detect docked DevTools safely ONLY when not embedded inside an iframe (to avoid iframe false positives)
    const isStandaloneWindow = (() => {
      try {
        return window.self === window.top;
      } catch {
        return false;
      }
    })();

    const runDevToolsCheckAndDebugTrap = () => {
      let dockedOpen = false;
      if (isStandaloneWindow) {
        const widthDiff = window.outerWidth - window.innerWidth;
        const heightDiff = window.outerHeight - window.innerHeight;
        dockedOpen = widthDiff > 210 || heightDiff > 230;
        if (dockedOpen) {
          setCurtainReason("devtools");
        }
      }

      // Active debug trap: harmless (~0ms) when DevTools is closed;
      // pauses DevTools execution and locks the screen when Inspect Element is open.
      const startedAt = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const elapsedMs = performance.now() - startedAt;

      if (elapsedMs > 80 || dockedOpen) {
        setCurtainReason("devtools");
      } else {
        setCurtainReason((prev) => (prev === "devtools" ? null : prev));
      }
    };

    const devToolsInterval = window.setInterval(runDevToolsCheckAndDebugTrap, 450);

    document.addEventListener("contextmenu", preventDefault, true);
    document.addEventListener("copy", preventDefault, true);
    document.addEventListener("cut", preventDefault, true);
    document.addEventListener("selectstart", preventDefault, true);
    document.addEventListener("dragstart", preventDefault, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("beforeprint", handleBeforePrint);

    return () => {
      if (screenshotTimeout) window.clearTimeout(screenshotTimeout);
      window.clearInterval(devToolsInterval);
      document.removeEventListener("contextmenu", preventDefault, true);
      document.removeEventListener("copy", preventDefault, true);
      document.removeEventListener("cut", preventDefault, true);
      document.removeEventListener("selectstart", preventDefault, true);
      document.removeEventListener("dragstart", preventDefault, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("beforeprint", handleBeforePrint);
    };
  }, []);

  if (!curtainReason) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-[#051D35]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center text-white select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="w-14 h-14 rounded-2xl bg-white/10 border border-[#BE9662]/40 flex items-center justify-center mb-4">
        {curtainReason === "devtools" ? (
          <ShieldAlert size={28} className="text-[#BE9662]" />
        ) : (
          <EyeOff size={28} className="text-[#BE9662]" />
        )}
      </div>

      <h2 className="font-title text-base font-semibold text-white mb-2">
        {curtainReason === "devtools"
          ? "Acces restricționat (Inspector detectat)"
          : curtainReason === "screenshot"
          ? "Captură de ecran / tipărire blocată"
          : "Prezentare protejată"}
      </h2>

      <p className="text-xs text-gray-300 max-w-md leading-relaxed">
        {curtainReason === "devtools"
          ? "Pentru protejarea datelor și a fotografiilor proprietății, utilizarea instrumentelor de inspectare nu este permisă pe linkurile publice. Închideți Inspectorul pentru a continua."
          : curtainReason === "screenshot"
          ? "Copierea, tipărirea sau salvarea fotografiilor și a conținutului sunt restricționate pe această pagină."
          : "Conținutul a fost ascuns temporar cât timp fereastra nu este activă. Reveniți în pagină pentru a vizualiza proprietatea."}
      </p>

      {curtainReason === "devtools" && (
        <button
          type="button"
          onClick={() => {
            const t0 = performance.now();
            // eslint-disable-next-line no-debugger
            debugger;
            if (performance.now() - t0 <= 80) {
              setCurtainReason(null);
            }
          }}
          className="mt-5 px-4 py-2 rounded-lg bg-[#BE9662] hover:bg-[#a8824f] text-white text-xs font-semibold transition-colors cursor-pointer"
        >
          Am închis inspectorul
        </button>
      )}
    </div>
  );
};
