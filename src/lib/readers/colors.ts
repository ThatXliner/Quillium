/**
 * Lighten a hex color to ~90% lightness for persona avatar backgrounds.
 */
export function lightTint(hex: string): string {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.85);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Medium tint for persona avatar borders (~60% lightness).
 */
export function mediumTint(hex: string): string {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.55);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
