export const FPS = 30;

export const ASPECT_RATIOS = {
  "9:16": { width: 1080, height: 1920, label: "TikTok / Reels / Shorts" },
  "16:9": { width: 1920, height: 1080, label: "YouTube" },
  "1:1": { width: 1080, height: 1080, label: "Square" },
  "4:5": { width: 1080, height: 1350, label: "Instagram feed" },
} as const;

export type AspectRatio = keyof typeof ASPECT_RATIOS;

/** Words per minute for reading-mode tafsir hold times. */
export const READING_SPEEDS = {
  fast: 260,
  slow: 180,
  verySlow: 120,
} as const;

export type ReadingSpeed = keyof typeof READING_SPEEDS;

/** `qfRecitationId` is the same recitation on Quran Foundation (source of word timings). */
export const DEFAULT_RECITERS: { id: string; name: string; source: "everyayah"; qfRecitationId?: number }[] = [
  { id: "Alafasy_128kbps", name: "Mishary Alafasy", source: "everyayah", qfRecitationId: 7 },
  { id: "Husary_128kbps", name: "Mahmoud Khalil Al-Husary", source: "everyayah", qfRecitationId: 6 },
  { id: "Minshawy_Murattal_128kbps", name: "Mohamed Siddiq Al-Minshawi", source: "everyayah", qfRecitationId: 9 },
  { id: "Abdul_Basit_Murattal_192kbps", name: "Abdul Basit (Murattal)", source: "everyayah", qfRecitationId: 2 },
  { id: "Maher_AlMuaiqly_64kbps", name: "Maher Al-Muaiqly", source: "everyayah" },
  { id: "Ghamadi_40kbps", name: "Saad Al-Ghamdi", source: "everyayah" },
];

export const DEFAULT_TAFSIRS = [
  { id: "ar.muyassar", name: "التفسير الميسر", language: "ar", source: "alquran" as const },
  { id: "ar.jalalayn", name: "تفسير الجلالين", language: "ar", source: "alquran" as const },
  { id: "ar.qurtubi", name: "تفسير القرطبي", language: "ar", source: "alquran" as const },
  { id: "ar.baghawi", name: "تفسير البغوي", language: "ar", source: "alquran" as const },
  { id: "ar.waseet", name: "التفسير الوسيط", language: "ar", source: "alquran" as const },
  { id: "ar.miqbas", name: "تنوير المقباس", language: "ar", source: "alquran" as const },
];

export const AMBIENCE_PRESETS = [
  { id: "rain", name: "Rain", nameAr: "مطر" },
  { id: "wind", name: "Wind", nameAr: "ريح" },
  { id: "ocean", name: "Ocean", nameAr: "بحر" },
  { id: "forest", name: "Forest", nameAr: "غابة" },
] as const;
