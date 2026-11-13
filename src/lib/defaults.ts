export type Settings = {
  theme: "system" | "light" | "dark";
  accent: string;
  glass: number; // 20..90 surface opacity %
  animations: "full" | "reduced" | "off";
  gridCols: number; // 2..6
  gridGap: number; // px
  thumbQuality: "low" | "balanced" | "high";
  defaultPage: "home" | "albums" | "library";
  doubleTapZoom: boolean;
  defaultZoom: number;
  swipeNav: boolean;
  hdPreview: boolean;
  showInfoOnOpen: boolean;
  videoSpeed: number;
  holdSpeed: number;
  gestureSens: number; // 0.5..2
  seekSeconds: number;
  resume: boolean;
  subtitleSize: number; // %
  subtitleColor: string;
  videoBrightness: number; // default software brightness 0..100
  videoVolume: number; // default volume 0..100
  editorQuality: number;
  editorFormat: "jpeg" | "png" | "webp";
  editorMaxSize: number; // 0 = original
  preserveOriginal: boolean;
  trashDays: number;
  lowMemory: boolean;
  bgScan: boolean;
  autoLock: number; // minutes, 0 = never (until closed)
  vaultHidden: boolean;
  showHiddenAlbums: boolean;
  dragHoldMs: number;
  albumLayout: "grid2" | "grid3" | "grid4" | "list" | "large" | "compact";
  albumGap: number;
  slideshowSeconds: number;
  sorts: Record<string, string>;
  groups: Record<string, string>;
};

export const defaultSettings: Settings = {
  theme: "system",
  accent: "#0a84ff",
  glass: 58,
  animations: "full",
  gridCols: 4,
  gridGap: 2,
  thumbQuality: "balanced",
  defaultPage: "home",
  doubleTapZoom: true,
  defaultZoom: 2.5,
  swipeNav: true,
  hdPreview: true,
  showInfoOnOpen: false,
  videoSpeed: 1,
  holdSpeed: 2,
  gestureSens: 1,
  seekSeconds: 10,
  resume: true,
  subtitleSize: 100,
  subtitleColor: "#ffffff",
  videoBrightness: 100,
  videoVolume: 100,
  editorQuality: 90,
  editorFormat: "jpeg",
  editorMaxSize: 0,
  preserveOriginal: true,
  trashDays: 30,
  lowMemory: false,
  bgScan: true,
  autoLock: 5,
  vaultHidden: false,
  showHiddenAlbums: false,
  dragHoldMs: 2000,
  albumLayout: "grid2",
  albumGap: 12,
  slideshowSeconds: 3,
  sorts: {},
  groups: {},
};
