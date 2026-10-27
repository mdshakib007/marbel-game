// Two-language UI: English and Bangla. The language is picked automatically
// from the player's location (Bangladesh -> Bangla) unless they chose one
// themselves, which is remembered. Strings live here; the page marks static
// text with data-i18n attributes and the code asks t() for dynamic text.

const STORAGE_KEY = 'marbel.lang';
const GEO_URL = 'https://ipwho.is/';
const GEO_TIMEOUT_MS = 2500;

export const LANGS = ['en', 'bn'];

const DICT = {
  en: {
    'lang.en': 'English',
    'lang.bn': 'বাংলা',

    'setup.title': 'Marbel',
    'setup.language': 'Language',
    'setup.name': 'Your name',
    'setup.nameDefault': 'You',
    'setup.size': 'Marble size',
    'setup.style': 'Marble style',
    'setup.colour': 'Colour',
    'setup.opponent': 'Computer opponent',
    'setup.end': 'Game end',
    'setup.fun': 'Just for fun',
    'setup.target': 'First to',
    'setup.targetNote': 'points',
    'setup.yard': 'Yard surface',
    'setup.newYard': 'New yard',
    'setup.start': 'Start game',

    'size.small': 'Small',
    'size.medium': 'Medium',
    'size.big': 'Big',
    'style.catseye': "Cat's eye",
    'style.swirl': 'Swirl',
    'style.galaxy': 'Galaxy',
    'style.clear': 'Clear',
    'style.opal': 'Opal',
    'color.red': 'Red',
    'color.blue': 'Blue',
    'color.green': 'Green',
    'color.yellow': 'Yellow',
    'color.orange': 'Orange',
    'color.purple': 'Purple',
    'color.teal': 'Teal',
    'color.pink': 'Pink',
    'level.easy': 'Easy',
    'level.medium': 'Medium',
    'level.hard': 'Hard',

    'hud.computer': 'Computer',
    'hud.power': 'POWER',
    'hud.powerTitle': 'Has entered the cave: can flick hard',
    'hud.inHand': 'marble in hand',
    'hud.hasPower': '{size} · has the power',
    'hud.needsCave': '{size} · needs the cave',
    'hud.topView': 'Top view (T)',
    'hud.sound': 'Sound (M)',
    'hud.menu': 'Menu (Esc)',
    'hud.lobAngle': 'Lob angle',
    'hud.linePos': 'Position on the line',
    'hud.thinking': 'Computer is thinking…',
    'hud.overhead': 'overhead',
    'hud.lob': 'Lob',
    'hud.powerFlick': 'POWER flick',
    'hud.weakFlick': 'Weak flick',
    'hud.speed': '{label} · {v} m/s',

    'hint.throw': 'Drag back from your marble and release to lob it at the cave. Wheel / ↑↓ changes the angle.',
    'hint.powered': "You have the POWER: pull back hard and knock the computer's marble away from the cave!",
    'hint.weak': 'No power yet: pull back from your marble for a gentle flick. Get into the cave to earn the power.',
    'hint.extra': 'Hit! You shoot again.',
    'hint.caveTurn': "You're in the cave — you have the POWER and you shoot again.",
    'hint.lifting': 'Lifting the marble out of the cave…',
    'hint.aiThrow': 'The computer lobs its marble from the line…',
    'hint.aiFlick': 'The computer is lining up its flick…',
    'hint.aiAgain': 'The computer shoots again…',
    'hint.flying': 'Flying…',
    'hint.rolling': 'Rolling…',

    'toast.youFirst': "You're closest to the cave — you move first",
    'toast.theyFirst': '{name} is closest to the cave and moves first',
    'toast.shatterYou': 'Your marble SHATTERED! A new one must be thrown from the line.',
    'toast.shatterThey': "{name}'s marble SHATTERED! A new one must be thrown from the line.",

    'menu.paused': 'Paused',
    'menu.how': 'How to play',
    'menu.rule1': 'Both players lob their marble from the line at the cave. Closest goes first.',
    'menu.rule2': 'Without the power you can only flick weakly. Get your marble into the cave to win the power — that earns no points, but whoever enters the cave moves next.',
    'menu.rule3': 'With the power you flick hard: knock your rival away from the cave.',
    'menu.rule4': "Only the power scores: a hit with the power earns 1 point. Hitting a rival who has the power while you don't earns 2 points and takes their power. Two marbles without the power score nothing. A hit earns another shot.",
    'menu.rule5': 'A marble resting inside the cave is safe: touching it scores nothing unless you knock it out of the cave.',
    'menu.rule6': 'A hit can — very rarely — shatter a marble. Its owner throws a new one from the line, without the power.',
    'menu.modeFun': 'Just for fun — end the game from here whenever you like.',
    'menu.modeTarget': 'First to {n} points wins.',
    'menu.resume': 'Resume',
    'menu.end': 'End game',
    'menu.new': 'New game',

    'over.title': 'Game over',
    'over.win': 'You win!',
    'over.lose': '{name} wins!',
    'over.draw': 'Draw!',
    'over.ended': 'Game ended.',
    'over.reached': '{name} reached {n} points first.',
    'over.player': 'Player',
    'over.points': 'Points',
    'over.hits': 'Hits',
    'over.caves': 'Caves',
    'over.broken': 'Broken',
    'over.rematch': 'Rematch',
    'over.new': 'New game',
  },

  bn: {
    'lang.en': 'English',
    'lang.bn': 'বাংলা',

    'setup.title': 'মার্বেল',
    'setup.language': 'ভাষা',
    'setup.name': 'তোমার নাম',
    'setup.nameDefault': 'তুমি',
    'setup.size': 'মার্বেলের আকার',
    'setup.style': 'মার্বেলের ধরন',
    'setup.colour': 'রং',
    'setup.opponent': 'কম্পিউটার প্রতিপক্ষ',
    'setup.end': 'খেলা শেষ হবে',
    'setup.fun': 'শুধু মজার জন্য',
    'setup.target': 'আগে',
    'setup.targetNote': 'পয়েন্টে পৌঁছালে',
    'setup.yard': 'উঠানের মাটি',
    'setup.newYard': 'নতুন উঠান',
    'setup.start': 'খেলা শুরু',

    'size.small': 'ছোট',
    'size.medium': 'মাঝারি',
    'size.big': 'বড়',
    'style.catseye': 'বিড়ালচোখ',
    'style.swirl': 'ঘূর্ণি',
    'style.galaxy': 'ছায়াপথ',
    'style.clear': 'স্বচ্ছ',
    'style.opal': 'ওপাল',
    'color.red': 'লাল',
    'color.blue': 'নীল',
    'color.green': 'সবুজ',
    'color.yellow': 'হলুদ',
    'color.orange': 'কমলা',
    'color.purple': 'বেগুনি',
    'color.teal': 'সবুজাভ নীল',
    'color.pink': 'গোলাপি',
    'level.easy': 'সহজ',
    'level.medium': 'মাঝারি',
    'level.hard': 'কঠিন',

    'hud.computer': 'কম্পিউটার',
    'hud.power': 'পাওয়ার',
    'hud.powerTitle': 'গর্তে ঢুকেছে: জোরে টোকা দিতে পারবে',
    'hud.inHand': 'মার্বেল হাতে',
    'hud.hasPower': '{size} · পাওয়ার আছে',
    'hud.needsCave': '{size} · গর্তে ঢুকতে হবে',
    'hud.topView': 'উপর থেকে দেখো (T)',
    'hud.sound': 'শব্দ (M)',
    'hud.menu': 'মেনু (Esc)',
    'hud.lobAngle': 'ছোঁড়ার কোণ',
    'hud.linePos': 'দাগের উপর অবস্থান',
    'hud.thinking': 'কম্পিউটার ভাবছে…',
    'hud.overhead': 'উপর থেকে',
    'hud.lob': 'ছোঁড়া',
    'hud.powerFlick': 'পাওয়ার টোকা',
    'hud.weakFlick': 'দুর্বল টোকা',
    'hud.speed': '{label} · {v} মি/সে',

    'hint.throw': 'মার্বেল থেকে পেছনে টেনে ছেড়ে দাও, গর্তের দিকে ছুঁড়ে দেবে। হুইল / ↑↓ দিয়ে কোণ বদলাও।',
    'hint.powered': 'তোমার পাওয়ার আছে: জোরে টেনে কম্পিউটারের মার্বেলকে গর্ত থেকে দূরে সরিয়ে দাও!',
    'hint.weak': 'এখনো পাওয়ার নেই: আলতো টোকার জন্য মার্বেল থেকে পেছনে টানো। পাওয়ার পেতে গর্তে ঢোকো।',
    'hint.extra': 'লেগেছে! তুমি আবার শট নেবে।',
    'hint.caveTurn': 'তুমি গর্তে ঢুকেছ — তোমার পাওয়ার আছে, আবার তোমার শট।',
    'hint.lifting': 'মার্বেল গর্ত থেকে তোলা হচ্ছে…',
    'hint.aiThrow': 'কম্পিউটার দাগ থেকে মার্বেল ছুঁড়ছে…',
    'hint.aiFlick': 'কম্পিউটার টোকার নিশানা ঠিক করছে…',
    'hint.aiAgain': 'কম্পিউটার আবার শট নিচ্ছে…',
    'hint.flying': 'উড়ছে…',
    'hint.rolling': 'গড়াচ্ছে…',

    'toast.youFirst': 'তুমি গর্তের সবচেয়ে কাছে — তুমি আগে খেলবে',
    'toast.theyFirst': '{name} গর্তের সবচেয়ে কাছে, সে আগে খেলবে',
    'toast.shatterYou': 'তোমার মার্বেল ভেঙে গেছে! দাগ থেকে নতুন একটা ছুঁড়তে হবে।',
    'toast.shatterThey': '{name}-এর মার্বেল ভেঙে গেছে! দাগ থেকে নতুন একটা ছুঁড়তে হবে।',

    'menu.paused': 'বিরতি',
    'menu.how': 'কীভাবে খেলবে',
    'menu.rule1': 'দুজনেই দাগ থেকে গর্তের দিকে মার্বেল ছোঁড়ে। যে সবচেয়ে কাছে, সে আগে খেলে।',
    'menu.rule2': 'পাওয়ার ছাড়া শুধু দুর্বল টোকা দেওয়া যায়। মার্বেল গর্তে ঢোকালে পাওয়ার পাবে — তাতে পয়েন্ট নেই, তবে যে গর্তে ঢোকে, পরের চাল তার।',
    'menu.rule3': 'পাওয়ার থাকলে জোরে টোকা দেওয়া যায়: প্রতিপক্ষকে গর্ত থেকে দূরে সরিয়ে দাও।',
    'menu.rule4': 'পয়েন্ট শুধু পাওয়ারেই: পাওয়ার নিয়ে আঘাত করলে ১ পয়েন্ট। তোমার পাওয়ার নেই কিন্তু পাওয়ারওয়ালা প্রতিপক্ষকে আঘাত করলে ২ পয়েন্ট, আর তার পাওয়ার চলে যায়। দুজনেরই পাওয়ার না থাকলে আঘাতে পয়েন্ট নেই। আঘাত করলে আবার শট পাবে।',
    'menu.rule5': 'গর্তের ভেতরে থাকা মার্বেল নিরাপদ: গর্ত থেকে বের করে না দিলে ছোঁয়ায় পয়েন্ট নেই।',
    'menu.rule6': 'আঘাতে — খুব কমই — মার্বেল ভেঙে যেতে পারে। মালিক দাগ থেকে নতুন একটা ছোঁড়ে, পাওয়ার ছাড়া।',
    'menu.modeFun': 'শুধু মজার জন্য — যখন খুশি এখান থেকে খেলা শেষ করো।',
    'menu.modeTarget': 'আগে {n} পয়েন্ট করলে জয়।',
    'menu.resume': 'চালিয়ে যাও',
    'menu.end': 'খেলা শেষ',
    'menu.new': 'নতুন খেলা',

    'over.title': 'খেলা শেষ',
    'over.win': 'তুমি জিতেছ!',
    'over.lose': '{name} জিতেছে!',
    'over.draw': 'ড্র!',
    'over.ended': 'খেলা শেষ করা হয়েছে।',
    'over.reached': '{name} আগে {n} পয়েন্টে পৌঁছেছে।',
    'over.player': 'খেলোয়াড়',
    'over.points': 'পয়েন্ট',
    'over.hits': 'আঘাত',
    'over.caves': 'গর্ত',
    'over.broken': 'ভাঙা',
    'over.rematch': 'আবার খেলো',
    'over.new': 'নতুন খেলা',
  },
};

let current = 'en';

export function getLang() {
  return current;
}

/** Translate a key, filling {name}-style parameters. Falls back to English. */
export function t(key, params = null) {
  let s = DICT[current][key] ?? DICT.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}

/** Default player names in every language (so a saved default is re-translated). */
export function isDefaultName(name) {
  return LANGS.some((l) => DICT[l]['setup.nameDefault'] === name);
}

/** Switch language; `remember` stores the choice as the player's own. */
export function setLang(lang, remember = false) {
  if (!LANGS.includes(lang)) lang = 'en';
  current = lang;
  document.documentElement.lang = lang;
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }
}

/** Fill every element marked with data-i18n / data-i18n-title / data-i18n-placeholder. */
export function applyDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

function savedLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Pick the language: the player's own choice if they made one; otherwise
 * Bangla for a browser set to Bangla or a connection from Bangladesh (a
 * quick geo-IP lookup with a short timeout), else English.
 */
export async function detectLang() {
  const saved = savedLang();
  if (saved) return saved;
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('bn')) return 'bn';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
    const res = await fetch(GEO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const info = await res.json();
      if (info && info.country_code === 'BD') return 'bn';
    }
  } catch {
    /* offline or blocked: keep the default */
  }
  return 'en';
}
