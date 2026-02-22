/**
 * Global type declarations for browser globals loaded via <script> tags.
 */

import type * as Leaflet from 'leaflet';

// Leaflet loaded via CDN script tag — available as global `L`
declare global {
  const L: typeof Leaflet;

  // Socket.IO loaded via CDN script tag
  const io: typeof import('socket.io-client').io;

  // Custom globals set by game scripts
  interface Window {
    // Socket.IO client instance
    socket: any;
    getSocket: (() => any) | undefined;
    initializeWebSocket: ((sessionToken?: string) => void) | undefined;

    // Game init
    initGame: ((progress: (msg: string, pct: number) => void) => Promise<void>) | undefined;

    // Region/path rendering (loaded from external .js scripts)
    loadAndRenderRegions: (() => void) | undefined;
    loadAndRenderPaths: (() => Promise<void>) | undefined;
    buildPath: {
      setWalkerPositions: (positions: any[], currentIndex?: number) => void;
      updateWalkerCurrentIndex: (index: number) => void;
      clearWalkerPath: () => void;
    } | undefined;

    // Shoutbox & log (set by HTML partials)
    addLogMessage: ((message: string, type?: string) => void) | undefined;
    onShoutboxMessage: ((data: any) => void) | undefined;
    onLogMessage: ((data: any) => void) | undefined;

    // Screenshot manager
    screenshotManager: { getScreenshotUrl: (filename: string) => string } | undefined;

    // Server time
    updateServerTimeUI: ((data: any) => void) | undefined;

    // Audio
    AudioManager: any;
  }
}
