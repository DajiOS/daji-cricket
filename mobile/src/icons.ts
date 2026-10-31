import GLYPHS from './phosphor-glyphs.json';

// The app's icon names (the Ionicons names every screen already uses) drawn with Phosphor icons. An "-outline" name is drawn in the
// line style; the plain name is drawn filled where the old icon was filled. A name not listed here falls back to the built-in set.
const MAP: Record<string, string> = {
  add: 'plus', albums: 'stack', baseball: 'baseball', book: 'book-open', briefcase: 'briefcase', bulb: 'lightbulb', calendar: 'calendar-dots',
  card: 'credit-card', car: 'car', cash: 'money', checkbox: 'check-square', 'checkmark-circle': 'check-circle', checkmark: 'check',
  'chevron-back': 'caret-left', 'chevron-down': 'caret-down', 'chevron-forward': 'caret-right', 'chevron-forward-circle': 'caret-circle-right',
  'chevron-up': 'caret-up', code: 'code', construct: 'hammer', contrast: 'circle-half', create: 'pencil-simple', document: 'file-text',
  ellipse: 'circle', chatbubble: 'chat-circle', videocam: 'video-camera', 'finger-print': 'fingerprint', grid: 'squares-four', home: 'house', 'id-card': 'identification-card', image: 'image',
  images: 'images', 'information-circle': 'info', key: 'key', language: 'translate', link: 'link', 'lock-closed': 'lock', 'log-in': 'sign-in',
  'log-out': 'sign-out', 'logo-whatsapp': 'whatsapp-logo', mic: 'microphone', open: 'arrow-square-out', options: 'sliders-horizontal',
  people: 'users-three', 'person-circle': 'user-circle', person: 'user', podium: 'ranking', power: 'power', pricetag: 'tag', radio: 'broadcast',
  receipt: 'receipt', 'return-down-back': 'arrow-u-down-left', school: 'graduation-cap', search: 'magnifying-glass', send: 'paper-plane-tilt',
  settings: 'gear-six', 'shield-checkmark': 'shield-check', sparkles: 'sparkle', text: 'text-aa', time: 'clock', today: 'calendar-check',
  trash: 'trash', trophy: 'trophy', wallet: 'wallet', water: 'drop', close: 'x', 'close-circle': 'x-circle', camera: 'camera', flag: 'flag',
  repeat: 'repeat', alarm: 'alarm', 'list': 'list-checks', filter: 'funnel', refresh: 'arrows-clockwise', 'ellipsis-horizontal': 'dots-three',
};
// Plain names that are line icons in the old set too, so they stay in the line style.
const LINE = new Set(['add', 'chevron-back', 'chevron-down', 'chevron-forward', 'chevron-up', 'checkmark', 'code', 'link', 'open', 'options', 'power', 'search', 'text', 'language', 'ellipse', 'close', 'ellipsis-horizontal', 'refresh']);

/** The Phosphor character and style for an icon name, or null to use the built-in set. */
export function glyphFor(name: string): { char: string; fill: boolean } | null {
  const outline = name.endsWith('-outline');
  const base = outline ? name.slice(0, -'-outline'.length) : name;
  const ph = MAP[base];
  const code = ph ? (GLYPHS as Record<string, number>)[ph] : undefined;
  return code ? { char: String.fromCodePoint(code), fill: !outline && !LINE.has(base) } : null;
}
