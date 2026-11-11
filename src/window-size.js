'use strict';
// Size the main window to the usable screen area (screen.getPrimaryDisplay().workAreaSize), so the dock and the
// right rail never start off-screen on a small display. Preferred size is 1280x860; the minimum stays 900x600.
const PREFERRED = { width: 1280, height: 860 };
const MIN = { width: 900, height: 600 };
const MARGIN = 40; // keeps the title bar and the window's own frame on screen

function windowSize(work) {
  const maxW = Math.max(MIN.width, work.width - MARGIN);
  const maxH = Math.max(MIN.height, work.height - MARGIN);
  return {
    width: Math.min(PREFERRED.width, maxW),
    height: Math.min(PREFERRED.height, maxH),
    minWidth: MIN.width,
    minHeight: MIN.height,
  };
}

module.exports = { windowSize, PREFERRED, MIN };
