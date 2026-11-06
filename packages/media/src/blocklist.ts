/** Tags / query terms that imply people — blocked from stock search. */
export const BLOCKED_TAGS = [
  "person",
  "persons",
  "people",
  "human",
  "humans",
  "woman",
  "women",
  "lady",
  "ladies",
  "girl",
  "girls",
  "man",
  "men",
  "guy",
  "guys",
  "boy",
  "boys",
  "child",
  "children",
  "kid",
  "kids",
  "baby",
  "toddler",
  "teen",
  "teenager",
  "mother",
  "father",
  "family",
  "couple",
  "bride",
  "groom",
  "wedding",
  "portrait",
  "selfie",
  "model",
  "fashion",
  "face",
  "body",
  "hand",
  "hands",
  "feet",
  "crowd",
  "actress",
  "actor",
  "dancer",
  "dance",
  "dancing",
  "tourist",
  "hiker",
  "surfer",
  "swimmer",
  "bikini",
  "worker",
  "silhouette",
  "hijab",
  "niqab",
];

/** Safe default search seeds for nature / abstract backgrounds. */
export const SAFE_QUERIES = [
  "nature landscape",
  "forest trees",
  "ocean waves",
  "mountain sunset",
  "desert dunes",
  "stars night sky",
  "waterfall",
  "clouds sky",
  "abstract light",
  "mosque architecture exterior",
  "green leaves",
  "rainfall",
];

const BLOCKED_RE = new RegExp(`(^|[^a-z])(${BLOCKED_TAGS.join("|")})([^a-z]|$)`, "i");

/** Matches whole words in free text, tag lists, or URL slugs ("woman-walking-on-beach"). */
export function containsBlockedTag(text: string): boolean {
  return BLOCKED_RE.test(text.toLowerCase());
}

export function sanitizeQuery(query: string): string {
  const cleaned = query
    .split(/\s+/)
    .filter((w) => !containsBlockedTag(w))
    .join(" ")
    .trim();
  return cleaned || "nature landscape";
}
