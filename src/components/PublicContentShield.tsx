import React, { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";

interface PublicContentShieldProps {
  onLockChange?: (locked: boolean) => void;
}

/**
 * Invokes an ephemeral `debugger` statement via Function constructor so production
 * minifiers cannot strip it and single-location "Never pause here" cannot bypass it.
 * Falls back to a direct `debugger` statement if CSP disallows Function().
 */
function triggerEphemeralDebuggerTrap(): number {
  const startedAt = performance.now();
  try {
    const trap = (() => {}).constructor("debugger");
    trap();
  } catch {
    // eslint-disable-next-line no-debugger
    debugger;
  }
  return performance.now() - startedAt;
}

/**
 * Active protection shield mounted STRICTLY on external public shared pages (/share/:id, /p/:id).
 * - Blocks right-click (contextmenu) everywhere on the page.
 * - Blocks Inspect Element / DevTools keyboard shortcuts (F12, Ctrl/Cmd+Shift+I/J/C/K, Cmd+Opt+I/J/C/U, Ctrl/Cmd+U, Shift+F10).
 * - Runs a continuous ephemeral debugger trap + DevTools detection that pauses DevTools and locks/hides page content while Inspect Element is open.
 */
export const PublicContentShield: React.FC<PublicContentShieldProps> = ({ onLockChange }) => {
  const [devToolsDetected, setDevToolsDetected] = useState(false);

  useEffect(() => {
    onLockChange?.(devToolsDetected);
  }, [devToolsDetected, onLockChange]);

  useEffect(() => {
    let isDisposed = false;
    let trapTimer: number | null = null;
    let rafId: number | null = null;
    let isCurrentlyLocked = false;

    const updateLockedState = (locked: boolean) => {
      if (isDisposed) return;
      isCurrentlyLocked = locked;
      setDevToolsDetected(locked);
    };

    const blockContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if ("stopImmediatePropagation" in e && typeof (e as any).stopImmediatePropagation === "function") {
        (e as any).stopImmediatePropagation();
      }
      return false;
    };

    const blockRightMouseDown = (e: MouseEvent) => {
      if (e.button === 2 || e.buttons === 2) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const code = (e.code || "").toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // Block keyboard-triggered context menu (ContextMenu key / Shift+F10)
      if (key === "contextmenu" || (e.shiftKey && key === "f10")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Block Inspect Element / DevTools & View Source shortcuts:
      // F12, Ctrl/Cmd+Shift+I/J/C/K, Cmd+Option+I/J/C/K/U, Ctrl/Cmd+U
      const isDevToolsShortcut =
        key === "f12" ||
        code === "f12" ||
        (ctrlOrMeta && e.shiftKey && (key === "i" || key === "j" || key === "c" || key === "k")) ||
        (e.metaKey && e.altKey && (key === "i" || key === "j" || key === "c" || key === "k" || key === "u")) ||
        (ctrlOrMeta && key === "u");

      if (isDevToolsShortcut) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") {
          e.stopImmediatePropagation();
        }
        updateLockedState(true);
        // Immediately fire trap on DevTools shortcut attempt
        triggerEphemeralDebuggerTrap();
      }
    };

    // Detect docked DevTools ONLY when rendered as a standalone top-level desktop window
    // (avoids iframe and mobile toolbar false positives).
    const isStandaloneWindow = (() => {
      try {
        return window.self === window.top;
      } catch {
        return false;
      }
    })();

    const isDockedDevToolsOpen = (): boolean => {
      if (!isStandaloneWindow) return false;
      if (window.innerWidth < 640) return false;
      const widthDiff = window.outerWidth - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      return widthDiff > 220 || heightDiff > 240;
    };

    const runDebugTrapCheck = () => {
      if (isDisposed) return;

      const dockedOpen = isDockedDevToolsOpen();
      if (dockedOpen && !isCurrentlyLocked) {
        updateLockedState(true);
      }

      const elapsedMs = triggerEphemeralDebuggerTrap();
      const trapped = elapsedMs > 80;

      if (trapped || dockedOpen) {
        updateLockedState(true);
      } else if (isCurrentlyLocked) {
        updateLockedState(false);
      }

      // Tighter loop while DevTools is open to keep Inspect Element trapped;
      // lightweight interval when DevTools is closed.
      const nextDelayMs = trapped || dockedOpen ? 120 : 400;
      trapTimer = window.setTimeout(() => {
        if (!isDisposed) {
          rafId = window.requestAnimationFrame(runDebugTrapCheck);
        }
      }, nextDelayMs);
    };

    const handleResize = () => {
      if (isDockedDevToolsOpen()) {
        updateLockedState(true);
        triggerEphemeralDebuggerTrap();
      }
    };

    window.addEventListener("contextmenu", blockContextMenu, true);
    document.addEventListener("contextmenu", blockContextMenu, true);
    document.addEventListener("mousedown", blockRightMouseDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleResize);

    // Kick off debug trap immediately on mount
    runDebugTrapCheck();

    return () => {
      isDisposed = true;
      if (trapTimer !== null) window.clearTimeout(trapTimer);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("contextmenu", blockContextMenu, true);
      document.removeEventListener("contextmenu", blockContextMenu, true);
      document.removeEventListener("mousedown", blockRightMouseDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  if (!devToolsDetected) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-[#051D35]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center text-white select-none"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="w-14 h-14 rounded-2xl bg-white/10 border border-[#BE9662]/40 flex items-center justify-center mb-4">
        <ShieldAlert size={28} className="text-[#BE9662]" />
      </div>

      <h2 className="font-title text-base font-semibold text-white mb-2">
        Acces restricționat (Inspector detectat)
      </h2>

      <p className="text-xs text-gray-300 max-w-md leading-relaxed">
        Pentru protejarea datelor și a fotografiilor proprietății, utilizarea funcției Inspect Element / Developer Tools este blocată pe această pagină. Închideți Inspectorul pentru a continua.
      </p>

      <button
        type="button"
        onClick={() => {
          const elapsed = triggerEphemeralDebuggerTrap();
          const widthDiff = window.outerWidth - window.innerWidth;
          const heightDiff = window.outerHeight - window.innerHeight;
          let standalone = false;
          try {
            standalone = window.self === window.top;
          } catch {
            standalone = false;
          }
          const docked =
            standalone &&
            window.innerWidth >= 640 &&
            (widthDiff > 220 || heightDiff > 240);

          if (elapsed <= 80 && !docked) {
            setDevToolsDetected(false);
          }
        }}
        className="mt-5 px-4 py-2 rounded-lg bg-[#BE9662] hover:bg-[#a8824f] text-white text-xs font-semibold transition-colors cursor-pointer"
      >
        Am închis inspectorul
      </button>
    </div>
  );
};
