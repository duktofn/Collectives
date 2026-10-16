/** Accent controls use hex so derived backgrounds and text contrast stay predictable. */
export function normalizeAccentColor(value: string | null | undefined): string | null {
  const hex = value?.trim().toLowerCase();
  if (!hex || !/^#(?:[\da-f]{3}|[\da-f]{6})$/.test(hex)) return null;
  return hex.length === 4 ? '#' + [...hex.slice(1)].map((digit) => digit + digit).join('') : hex;
}

export function accentColorVariables(value: string | null | undefined): Record<string, string> | null {
  const hex = normalizeAccentColor(value);
  if (!hex) return null;
  const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const linear = rgb.map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return {
    '--color-accent': hex,
    '--color-accent-hover': 'color-mix(in srgb, var(--color-accent) 88%, var(--accent-hover-target))',
    '--color-accent-bg': `rgba(${rgb.join(', ')}, 0.12)`,
    '--color-on-accent': luminance > 0.179 ? '#000000' : '#ffffff',
  };
}
