import { describe, expect, it } from "vitest";
import { hafsReads, mp3qAudioUrl, mp3qSpans, type Mp3qTiming } from "./mp3quran.js";

const read = (id: number, rewaya: string, folder = `https://cdn.mp3quran.net/audio/r${id}/`) => ({ id, name: `قارئ ${id}`, rewaya, folder_url: folder });

describe("hafsReads", () => {
  const reads = [
    read(1, "حفص عن عاصم"),
    read(2, "المصحف المجود"),
    read(3, "ورش عن نافع"),
    read(4, "قالون عن نافع"),
    read(5, "شعبة  عن عاصم"),
    read(6, "السوسي عن أبي عمرو"),
    read(7, "الدوري عن أبي عمرو"),
    read(8, "البزي عن ابن كثير"),
    read(9, " حفص  عن عاصم "),
    read(10, "حفص عن عاصم", "https://cdn.mp3quran.net/audio/moved/"),
  ];
  const reciters = [
    { name: "Reader One ", moshaf: [{ id: 1, server: "https://cdn.mp3quran.net/audio/r1/", surah_list: "1,2,3,112" }] },
    { name: "Reader Two", moshaf: [{ id: 2, server: "https://cdn.mp3quran.net/audio/r2/", surah_list: "1,114" }] },
    { name: "Reader Ten", moshaf: [{ id: 10, server: "https://cdn.mp3quran.net/audio/r10/", surah_list: "1" }] },
  ];
  const out = hafsReads(reads, reciters);

  it("keeps only Hafs 'an 'Asim (murattal and the mujawwad mushaf)", () => {
    expect(out.map((r) => r.id)).toEqual([1, 2, 9, 10]);
    expect(out.find((r) => r.id === 2)?.mujawwad).toBe(true);
    expect(out.find((r) => r.id === 1)?.mujawwad).toBe(false);
  });

  it("takes English names and surah lists from the matching moshaf, else the Arabic name", () => {
    expect(out[0]).toMatchObject({ name: "Reader One", nameAr: "قارئ 1", surahs: [1, 2, 3, 112] });
    expect(out.find((r) => r.id === 9)).toMatchObject({ name: "قارئ 9", surahs: null });
    // A moshaf whose server differs from the timing folder isn't the same recording.
    expect(out.find((r) => r.id === 10)).toMatchObject({ name: "قارئ 10", surahs: null });
  });

  it("builds the surah file URL", () => {
    expect(mp3qAudioUrl(out[0]!, 2)).toBe("https://cdn.mp3quran.net/audio/r1/002.mp3");
  });
});

describe("mp3qSpans", () => {
  const rows: Mp3qTiming[] = [
    { ayah: 0, start_time: 0, end_time: 8547 },
    { ayah: 1, start_time: 8547, end_time: 12096 },
    { ayah: 2, start_time: 12096, end_time: 16233 },
    { ayah: 3, start_time: 16233, end_time: 21063 },
    { ayah: 4, start_time: 21063, end_time: 25851 },
  ];

  it("maps ayat to their spans in the surah file, leaving out the ayah-0 lead-in", () => {
    const spans = mp3qSpans(rows, 1, 4)!;
    expect([...spans.keys()]).toEqual([1, 2, 3, 4]);
    expect(spans.get(1)).toEqual({ fromMs: 8547, toMs: 12096 });
    expect(spans.get(4)).toEqual({ fromMs: 21063, toMs: 25851 });
    // Run offsets are measured from the first ayah of the clip.
    expect(spans.get(3)!.fromMs - spans.get(2)!.fromMs).toBe(4137);
  });

  it("serves sub-ranges", () => {
    expect([...mp3qSpans(rows, 2, 3)!.values()]).toEqual([
      { fromMs: 12096, toMs: 16233 },
      { fromMs: 16233, toMs: 21063 },
    ]);
  });

  it("is null when an ayah is missing or has an empty span", () => {
    expect(mp3qSpans(rows, 1, 5)).toBeNull();
    expect(mp3qSpans([...rows.slice(0, 2), { ayah: 2, start_time: 12096, end_time: 12096 }], 1, 2)).toBeNull();
    expect(mp3qSpans([], 1, 1)).toBeNull();
  });
});
