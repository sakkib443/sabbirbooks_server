/**
 * Short memory for the media route's access check.
 *
 * Every figure on a page is its own HTTP request, and each one used to ask the
 * database the same four or five questions: which question holds this file,
 * which chapter, is the chapter free, is this person staff, do they own the
 * book. The first of those is a scan of the whole question collection — the
 * stored value is a full URL and the lookup is a suffix regex, which no index
 * can help. A topic with six figures paid for that six times over, and it grew
 * slower with every question the shop wrote.
 *
 * Nothing about the answers changes to fix that: the results are simply
 * remembered for a few minutes, in this process, and the questions are asked
 * again when the memory expires. No collection, document, index or schema is
 * touched, and a restart starts from nothing.
 *
 * Only ALLOWED decisions are remembered. A refusal is re-checked every time, so
 * a reader who has just activated their book is never told "no" by a memory of
 * the minute before they bought it.
 */

type Entry<T> = { value: T; until: number };

const cache = <T>(ttlMs: number, max = 2000) => {
  const entries = new Map<string, Entry<T>>();
  return {
    get(key: string): T | undefined {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.until <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      // Bounded, so a flood of unknown names cannot grow it without limit.
      // Map keeps insertion order, so the oldest quarter goes first.
      if (entries.size >= max) {
        let drop = Math.ceil(max / 4);
        for (const old of entries.keys()) {
          entries.delete(old);
          if (--drop <= 0) break;
        }
      }
      entries.set(key, { value, until: Date.now() + ttlMs });
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
};

/**
 * Which book a file belongs to, and whether its chapter is free.
 *
 * A file never moves between books, so this can be held for a while; ten
 * minutes means an answer that stops referencing a figure stops serving it
 * within ten minutes at worst.
 */
export const fileOwnerCache = cache<{ bookId: string; isFree: boolean }>(10 * 60 * 1000);

/** "this reader may read this book" — the shorter of the two, on purpose. */
export const readerAccessCache = cache<true>(2 * 60 * 1000);
