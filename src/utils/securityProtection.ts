/**
 * Global Security & Anti-Inspection Protection
 * 
 * Implements strict defense exclusively for public shared property pages (/share/:id or /p/:id):
 * 1. Blocks right-click (context menu).
 * 2. Blocks all developer shortcuts (F12, Ctrl+Shift+I, etc.).
 * 3. Prevents drag-and-drop of images.
 */

export function initGlobalSecurityProtection(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const isPublicSharePage = () => {
    const path = window.location.pathname;
    return path.startsWith("/share/") || path.startsWith("/p/");
  };

  // 1. Block right-click exclusively on public share pages
  const handleContextMenu = (e: MouseEvent) => {
    if (!isPublicSharePage()) return;
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  // 2. Block Inspect Element shortcuts exclusively on public share pages
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isPublicSharePage()) return;
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;

    if (e.key === "F12" || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (isCtrlOrMeta && e.shiftKey && ["I", "i", "J", "j", "C", "c", "K", "k"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (isCtrlOrMeta && (e.key === "U" || e.key === "u")) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (isCtrlOrMeta && (e.key === "S" || e.key === "s")) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (e.metaKey && e.altKey && ["I", "i", "J", "j", "C", "c"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  };

  // 3. Block Drag-and-Drop exclusively on public share pages
  const handleDragStart = (e: DragEvent) => {
    if (!isPublicSharePage()) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return true;
    }
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  // 4. Attach event listeners in CAPTURING phase
  window.addEventListener("contextmenu", handleContextMenu, true);
  document.addEventListener("contextmenu", handleContextMenu, true);
  window.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("dragstart", handleDragStart, true);
  document.addEventListener("dragstart", handleDragStart, true);

  // Return cleanup function
  return () => {
    window.removeEventListener("contextmenu", handleContextMenu, true);
    document.removeEventListener("contextmenu", handleContextMenu, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("dragstart", handleDragStart, true);
    document.removeEventListener("dragstart", handleDragStart, true);
  };
}
