/**
 * Single source of truth for UI color themes (uiTheme store).
 * Canonical list per docs/AGENT-HANDOFF-THEMES-AND-LAYOUTS.json; do not remove themes.
 * Used by Sidebar, CommandPalette, UiThemeSelect, and any layout that shows theme picker.
 */
export const UI_THEME_OPTIONS = [
  { value: 'atom', label: 'ATOM (Clinical)' },
  { value: 'default', label: 'Default (red)' },
  { value: 'cyberpunk', label: 'Cyberpunk Terminal' },
  { value: 'neural', label: 'Neural Network Blue' },
  { value: 'quantum', label: 'Quantum Purple' },
  { value: 'arctic', label: 'Arctic Command' },
  { value: 'neon', label: 'Neon Daylight' },
  { value: 'mint', label: 'Mint Laboratory' },
  { value: 'coral', label: 'Coral Reef' },
  { value: 'highcontrast', label: 'High Contrast Lab' },
  { value: 'cybercitrus', label: 'Cyber Citrus' },
  { value: 'industrialhazard', label: 'Industrial Hazard' },
  { value: 'fireice', label: 'Fire & Ice' },
  { value: 'hacker', label: 'Hacker Terminal Green' },
  { value: 'medical', label: 'Medical Grade' },
  { value: 'radioactivelab', label: 'Radioactive Lab (Neon Lime)' },
  { value: 'coppercircuit', label: 'Copper Circuit' },
  { value: 'arcticneon', label: 'Arctic Neon' },
  { value: 'sunsetgradient', label: 'Sunset Gradient' },
  { value: 'racingstripe', label: 'Racing Stripe' },
  { value: 'jungleterminal', label: 'Jungle Terminal' },
  { value: 'magmaflow', label: 'Magma Flow' },
  { value: 'chromeglass', label: 'Chrome & Glass' },
  { value: 'toxicwaste', label: 'Toxic Waste' },
  { value: 'oceandeep', label: 'Ocean Deep' },
];
