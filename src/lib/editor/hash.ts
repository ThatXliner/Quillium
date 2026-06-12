/**
 * hash.ts — Small synchronous string hash shared across editor subsystems.
 *
 * Kept dependency-free and stable: the annotation clipboard wire format bakes
 * this hash into a persistent payload key, so its output must not drift. Anything
 * that needs a cheap content key (the harper linter's paragraph cache, the
 * clipboard side-table) imports from here rather than each other.
 */

/**
 * FNV-1a 32-bit hash — sync, zero deps, good enough distribution for a cache key.
 * 2^32 output space; collision probability ≈ entries/4B (negligible at typical
 * cache sizes). https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 */
export function hashText(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
}
