/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#16271e',
    tint: '#22804c',

    // Core surfaces
    background: '#f6faf6',
    foreground: '#16271e',

    // Cards / elevated surfaces
    card: '#ffffff',
    cardForeground: '#16271e',

    // Primary action color (buttons, links, active states)
    primary: '#22804c',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#c31935',
    secondaryForeground: '#ffffff',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#edf4ee',
    mutedForeground: '#556e60',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#a72b44',
    accentForeground: '#ffffff',

    // Destructive actions (delete, error states)
    destructive: '#bd1e1e',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#d5e0d6',
    input: '#dbe5dc',
    forest: '#143d2a',
    forestDeep: '#0d3022',
    leaf: '#a5db76',
    mascotRed: '#e7463a',
    paper: '#fffdf7',
  },

  dark: {
    text: '#eaf1eb',
    tint: '#58c27b',
    background: '#0f1a14',
    foreground: '#eaf1eb',
    card: '#17261e',
    cardForeground: '#eaf1eb',
    primary: '#58c27b',
    primaryForeground: '#122117',
    secondary: '#cf2f4d',
    secondaryForeground: '#ffffff',
    muted: '#213128',
    mutedForeground: '#a3b8a7',
    accent: '#d93d63',
    accentForeground: '#ffffff',
    destructive: '#d74a54',
    destructiveForeground: '#ffffff',
    border: '#33463a',
    input: '#2e4235',
    forest: '#102b1d',
    forestDeep: '#091c12',
    leaf: '#a5db76',
    mascotRed: '#ed5e55',
    paper: '#13241a',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 11,
};

export default colors;
