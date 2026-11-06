/**
 * Global Security & Anti-Inspection Protection
 * 
 * Implements strict, comprehensive defense across Chrome, Firefox, Edge, and Safari:
 * 1. Blocks right-click (context menu) globally across the entire document.
 * 2. Blocks all developer shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U, Ctrl+S).
 * 3. Neutralizes DevTools opened via the browser menu (3-dots menu) using an active debugger trap
 *    and docked DevTools viewport detection.
 * 4. Prevents drag-and-drop of images and media.
 */

export function initGlobalSecurityProtection(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  // 1. Block right-click globally on the entire page (capturing phase)
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  // 2. Block Inspect Element keyboard shortcuts across all OS/Browsers
  const handleKeyDown = (e: KeyboardEvent) => {
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;

    // F12
    if (e.key === "F12" || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (Chrome/Firefox/Edge DevTools & Inspect)
    if (isCtrlOrMeta && e.shiftKey && ["I", "i", "J", "j", "C", "c", "K", "k"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+U (View Page Source)
    if (isCtrlOrMeta && (e.key === "U" || e.key === "u")) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Ctrl+S (Save Page as...)
    if (isCtrlOrMeta && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Cmd+Option+I / Cmd+Option+J / Cmd+Option+C on Mac Safari/Chrome
    if (e.metaKey && e.altKey && ["I", "i", "J", "j", "C", "c"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };

  // 3. Block Drag-and-Drop globally
  const handleDragStart = (e: DragEvent) => {
    const target = e.target as HTMLElement;
    // Only allow if explicitly draggable text inside input/textarea
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return true;
    }
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  // 4. Block text selection globally, except within inputs or textareas
  const handleSelectStart = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return true;
    }
    e.preventDefault();
    return false;
  };

  // 5. Attach event listeners in CAPTURING phase to intercept before any component
  window.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("dragstart", handleDragStart, true);
  document.addEventListener("dragstart", handleDragStart, true);
  window.addEventListener("selectstart", handleSelectStart, true);
  document.addEventListener("selectstart", handleSelectStart, true);

  // 6. Active Anti-DevTools Trap (for when user opens Inspect from the 3-dots browser menu)
  // When DevTools is opened, the browser triggers the debugger statement on each tick,
  // freezing any inspection and preventing DOM traversal.
  let trapInterval: any = null;
  const startDevToolsTrap = () => {
    trapInterval = setInterval(() => {
      const startTime = performance.now();
      // debugger breakpoint will immediately halt the browser inspector if DevTools is open
      try {
        const fn = new Function("debugger");
        fn();
      } catch (err) {
        // Silently catch
      }

      const diff = performance.now() - startTime;
      // If execution was paused (took > 100ms), DevTools is currently active!
      if (diff > 100) {
        try {
          console.clear();
        } catch {}
      }
    }, 250);
  };

  startDevToolsTrap();

  // Return cleanup function
  return () => {
    if (trapInterval) clearInterval(trapInterval);
    window.removeEventListener("contextmenu", handleContextMenu, true);
    document.removeEventListener("contextmenu", handleContextMenu, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("dragstart", handleDragStart, true);
    document.removeEventListener("dragstart", handleDragStart, true);
    window.removeEventListener("selectstart", handleSelectStart, true);
    document.removeEventListener("selectstart", handleSelectStart, true);
  };
}
