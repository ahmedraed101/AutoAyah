/** Colors used by printed tajweed mushafs, keyed by AlQuran.cloud tajweed rule codes. */
export const TAJWEED_COLORS: Record<string, string> = {
  h: "#aaaaaa", // hamzat wasl
  s: "#aaaaaa", // silent
  l: "#aaaaaa", // lam shamsiyyah
  n: "#537fff", // normal madd (2)
  p: "#4050ff", // permissible madd (2/4/6)
  m: "#000ebc", // necessary madd (6)
  o: "#2144c1", // obligatory madd (4/5)
  q: "#dd0008", // qalqalah
  c: "#d500b7", // ikhfa shafawi
  f: "#9400a8", // ikhfa
  w: "#58b800", // idgham shafawi
  i: "#26bffd", // iqlab
  a: "#169777", // idgham with ghunnah
  u: "#169200", // idgham without ghunnah
  d: "#a1a1a1", // idgham mutajanisayn
  b: "#a1a1a1", // idgham mutaqaribayn
  g: "#ff7e1e", // ghunnah
};

export type TajweedSegment = { text: string; color?: string };

const RULE = /\[([a-z])(?::\d+)?\[([^\]]*)\]/g;

export function parseTajweed(markup: string): TajweedSegment[] {
  const out: TajweedSegment[] = [];
  let last = 0;
  for (const m of markup.matchAll(RULE)) {
    if (m.index! > last) out.push({ text: markup.slice(last, m.index) });
    out.push({ text: m[2]!, color: TAJWEED_COLORS[m[1]!] });
    last = m.index! + m[0].length;
  }
  if (last < markup.length) out.push({ text: markup.slice(last) });
  return out;
}
