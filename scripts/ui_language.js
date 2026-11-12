/* Bidirectional presentation-only UI language layer.

   The source of this application is English. This module can display it in
   Chinese without touching calculation code, stored values, option
   identifiers, input values or geographic source data.

   Two dictionaries are used:
     CHINESE_UI  English source string -> Chinese display  (zh mode)
     ENGLISH_UI  Chinese source string -> English display  (en mode)

   A few modules still carry Chinese literals. In zh mode those are already
   correct and are left alone; in en mode they are translated exactly as the
   previous ui_english.js did, so en mode reproduces the current behaviour.

   Every node's original text is recorded before the first substitution, so
   switching languages always restores the source string first and never
   translates an already-translated string. */

import {CHINESE_UI} from './ui_chinese_dictionary.js?v=3.30.0-english';
import {ENGLISH_UI} from './ui_english_dictionary.js?v=3.30.0-english';

const STORAGE_KEY = 'londonMap.uiLanguage';
const DEFAULT_LANGUAGE = 'zh';
const HAN = /[㐀-鿿]/;
const RUNS = /[㐀-鿿]+/g;
const ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'aria-valuetext', 'alt', 'placeholder'];

/* ---------- English -> Chinese ---------- */

// Longest first so that a specific phrase always wins over a shorter one it
// contains. Rebuilding this on every call would be the hot path, so it is
// computed once.
const ZH_KEYS = Object.keys(CHINESE_UI).sort((a, b) => b.length - a.length);
// Only reasonably long keys are allowed to match inside a larger string;
// short labels such as "Run" or "Off" are whole-string matches only.
const ZH_EMBEDDABLE = ZH_KEYS.filter(key => key.length >= 8);

function normalise(value) {
  return value.replace(/\s+/g, ' ').trim();
}

// Runtime templates with numbers in the middle, which no fixed phrase can
// match. Each pattern must describe the whole segment.
const NUM = '(-?[\\d.,]+)';
const ZH_PATTERNS = [
  [new RegExp('^Lat ' + NUM + ' / Lng ' + NUM + ' / Zoom ' + NUM + '$'), '纬度 $1 / 经度 $2 / 缩放 $3'],
  [new RegExp('^Lat ' + NUM + '$'), '纬度 $1'],
  [new RegExp('^Lon ' + NUM + '$'), '经度 $1'],
  [new RegExp('^' + NUM + ' m raster$'), '$1 m 栅格'],
  [new RegExp('^' + NUM + ' buildings?$'), '$1 栋建筑'],
  [new RegExp('^buildings inside site ' + NUM + ' buildings?$'), '场地内建筑 $1 栋'],
  [new RegExp('^Area ' + NUM + ' km²$'), '面积 $1 km²'],
  [new RegExp('^EA surface water ' + NUM + ' cells available$'), 'EA 地表水 $1 个可用单元'],
  [new RegExp('^Building roof drainage routed outdoors ' + NUM + '/' + NUM + ' cells$'), '屋面排水排向室外 $1/$2 个单元'],
  [new RegExp('^' + NUM + ' facilities placed$'), '已放置 $1 个设施'],
];

function lookupWhole(text) {
  if (Object.hasOwn(CHINESE_UI, text)) return CHINESE_UI[text];
  for (const [pattern, replacement] of ZH_PATTERNS) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  // Prefixes stored with their separator ("… ·", "…:") also match the part
  // left after a status line is split on " · ".
  for (const suffix of [' ·', ':']) {
    const key = text + suffix;
    if (Object.hasOwn(CHINESE_UI, key)) return CHINESE_UI[key].replace(/\s*[·:：]\s*$/, '');
  }
  // A fixed phrase followed by trailing punctuation.
  const bare = text.replace(/[\s:：.。!！?？,，;；-]+$/, '');
  if (bare && bare !== text && Object.hasOwn(CHINESE_UI, bare)) {
    return CHINESE_UI[bare] + text.slice(bare.length);
  }
  return null;
}

const WORD = /[A-Za-z0-9]/;

// Replace every known phrase inside a longer string, longest first, without
// touching a phrase twice or matching inside a larger word. Whatever is left
// is dynamic content (numbers, names, error details) and is preserved.
function replaceEmbedded(text) {
  let out = text;
  const slots = [];
  for (const key of ZH_EMBEDDABLE) {
    if (out.length < key.length) continue;
    let at = out.indexOf(key);
    while (at !== -1) {
      const before = out[at - 1], after = out[at + key.length];
      const bounded = !(before && WORD.test(before) && WORD.test(key[0])) &&
                      !(after && WORD.test(after) && WORD.test(key[key.length - 1]));
      if (bounded) {
        const token = '\u0000' + slots.length + '\u0000';
        slots.push(CHINESE_UI[key]);
        out = out.slice(0, at) + token + out.slice(at + key.length);
        at = out.indexOf(key, at + token.length);
      } else {
        at = out.indexOf(key, at + 1);
      }
    }
  }
  if (!slots.length) return text;
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

function toChinese(value) {
  if (typeof value !== 'string') return value;
  const trimmed = normalise(value);
  if (!trimmed) return value;

  // 1. Whole string, with or without trailing punctuation.
  const whole = lookupWhole(trimmed);
  if (whole !== null) return tidy(whole);

  // 2. Status lines are often several facts joined with " · ". Translate each
  //    part on its own so every known part is converted, not just the first.
  if (trimmed.includes(' · ')) {
    const parts = trimmed.split(' · ');
    const translated = parts.map(part => lookupWhole(part) ?? replaceEmbedded(part));
    if (translated.some((part, i) => part !== parts[i])) return tidy(translated.join(' · '));
  }

  // 3. Known phrases embedded in a longer sentence.
  const embedded = replaceEmbedded(trimmed);
  return embedded === trimmed ? value : tidy(embedded);
}

// Full-width Chinese punctuation carries its own spacing.
function tidy(text) {
  return text.replace(/([：，。；（])\s+/g, '$1').replace(/\s+([）])/g, '$1');
}

/* ---------- Chinese -> English (previous ui_english.js behaviour) ---------- */

const EN_KEYS = Object.keys(ENGLISH_UI).sort((a, b) => b.length - a.length);
const EN_FALLBACK = EN_KEYS.length ? new RegExp(EN_KEYS.join('|'), 'g') : null;

function toEnglish(value) {
  if (typeof value !== 'string' || !HAN.test(value)) return value;
  return value
    .replace(RUNS, run => {
      if (Object.hasOwn(ENGLISH_UI, run)) return ' ' + ENGLISH_UI[run] + ' ';
      return EN_FALLBACK ? run.replace(EN_FALLBACK, key => ' ' + ENGLISH_UI[key] + ' ') : run;
    })
    .replace(/[。]/g, '. ').replace(/[，、]/g, ', ').replace(/[：]/g, ': ')
    .replace(/[；]/g, '; ').replace(/[！]/g, '! ').replace(/[？]/g, '? ')
    .replace(/[（]/g, ' (').replace(/[）]/g, ') ')
    .replace(/[「『【]/g, '[').replace(/[」』】]/g, ']')
    .replace(/(\d{4})\s+year\b/g, '$1')
    .replace(/[ \t]+/g, ' ').replace(/ +([,.;:!?\)\]])/g, '$1')
    .replace(/([\(\[]) +/g, '$1').trim();
}

/* ---------- translation entry point ---------- */

let language = DEFAULT_LANGUAGE;
const cache = new Map();

export function translateUI(value, mode = language) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const cacheKey = mode + '\u0000' + value;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const translated = mode === 'zh' ? toChinese(value) : toEnglish(value);
  if (cache.size >= 4096) cache.clear();
  cache.set(cacheKey, translated);
  return translated;
}

/* ---------- DOM application ---------- */

// For every node this module has touched: the source string it was given and
// the string this module last wrote. If the current value still equals what we
// wrote, the node is showing our translation and must be re-translated from
// the stored source on a language switch. If it differs, the application has
// written new content and that content becomes the new source. Without this
// second case, a status line would stay frozen on its first message.
const renderedText = new WeakMap();
const renderedAttributes = new WeakMap();

function excluded(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return !element || Boolean(element.closest(
    'script,style,noscript,textarea,[contenteditable]:not([contenteditable="false"]),[data-no-translate]'
  ));
}

function applyTextNode(node) {
  if (node?.nodeType !== 3 || excluded(node)) return;
  const record = renderedText.get(node);
  // Our own output still in place -> reuse the source. Anything else is new
  // application content and becomes the source.
  const source = record && record.rendered === node.nodeValue ? record.source : node.nodeValue;
  const translated = translateUI(source);
  let next = source;
  if (translated !== source) {
    // Chinese needs no spaces around inline icons, numbers or <kbd>; English
    // does. Preserve the original separation either way.
    const before = /^\s/.test(source) || node.previousSibling ? ' ' : '';
    const after = /\s$/.test(source) || node.nextSibling ? ' ' : '';
    next = before + translated.trim() + after;
  }
  renderedText.set(node, { source, rendered: next });
  if (node.nodeValue !== next) node.nodeValue = next;
}

function applyAttributes(element) {
  if (excluded(element)) return;
  // Explicit option values must never change. Preserve implicit option values
  // too, before translating the visible label.
  if (element.tagName === 'OPTION' && !element.hasAttribute('value')) {
    const label = renderedText.get(element.firstChild);
    element.setAttribute('value', label ? label.source : element.textContent);
  }
  let store = renderedAttributes.get(element);
  if (!store) {
    store = new Map();
    renderedAttributes.set(element, store);
  }
  for (const attribute of ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    const record = store.get(attribute);
    const source = record && record.rendered === current ? record.source : current;
    const next = translateUI(source);
    store.set(attribute, { source, rendered: next });
    if (current !== next) element.setAttribute(attribute, next);
  }
}

// The tab title lives in <head>, outside the body walk and the observer.
let sourceTitle = null;
function applyTitle(documentObject = globalThis.document) {
  if (!documentObject || typeof documentObject.title !== 'string') return;
  if (sourceTitle === null) sourceTitle = documentObject.title;
  const next = translateUI(sourceTitle);
  if (documentObject.title !== next) documentObject.title = next;
}

function applySubtree(root, documentObject = globalThis.document) {
  if (!root || !documentObject) return;
  if (root.nodeType === 3) { applyTextNode(root); return; }
  if (root.nodeType === 1) applyAttributes(root);
  const elements = documentObject.createTreeWalker(root, 1);
  while (elements.nextNode()) applyAttributes(elements.currentNode);
  const texts = documentObject.createTreeWalker(root, 4);
  while (texts.nextNode()) applyTextNode(texts.currentNode);
}

/* ---------- public control ---------- */

export function getLanguage() {
  return language;
}

export function setLanguage(next, documentObject = globalThis.document) {
  const mode = next === 'en' ? 'en' : 'zh';
  if (mode === language && documentObject?.documentElement?.dataset.uiLanguage === mode) return mode;
  language = mode;
  if (documentObject?.documentElement) {
    documentObject.documentElement.lang = mode === 'zh' ? 'zh-CN' : 'en';
    documentObject.documentElement.dataset.uiLanguage = mode;
  }
  try { globalThis.localStorage?.setItem(STORAGE_KEY, mode); } catch (error) { /* private mode */ }
  if (documentObject?.body) applySubtree(documentObject.body, documentObject);
  applyTitle(documentObject);
  syncSwitch(documentObject);
  documentObject?.dispatchEvent?.(new CustomEvent('uilanguagechange', { detail: { language: mode } }));
  return mode;
}

function readStoredLanguage() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch (error) { /* private mode */ }
  return DEFAULT_LANGUAGE;
}

// The switch labels live here rather than in index.html so the page source
// stays free of Chinese characters.
const SWITCH_LABELS = { zh: '中文', en: 'EN' };
const SWITCH_GROUP_LABEL = { zh: '界面语言', en: 'Interface language' };

function syncSwitch(documentObject = globalThis.document) {
  const group = documentObject?.getElementById?.('uiLanguageSwitch');
  if (!group) return;
  // The switch itself is data-no-translate, so its accessible name is set here.
  group.setAttribute('aria-label', SWITCH_GROUP_LABEL[language] ?? SWITCH_GROUP_LABEL.en);
  for (const button of group.querySelectorAll('button[data-language]')) {
    const mode = button.dataset.language;
    const label = SWITCH_LABELS[mode];
    if (label && button.textContent !== label) button.textContent = label;
    const active = mode === language;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function bindSwitch(documentObject = globalThis.document) {
  const group = documentObject?.getElementById?.('uiLanguageSwitch');
  if (!group) return;
  group.addEventListener('click', event => {
    const button = event.target.closest('button[data-language]');
    if (!button) return;
    setLanguage(button.dataset.language, documentObject);
  });
  syncSwitch(documentObject);
}

export function startLanguageUI(documentObject = globalThis.document, windowObject = globalThis.window) {
  if (!documentObject?.documentElement || !windowObject) return null;
  language = readStoredLanguage();
  documentObject.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  documentObject.documentElement.dataset.uiLanguage = language;
  applySubtree(documentObject.body, documentObject);
  applyTitle(documentObject);
  bindSwitch(documentObject);

  const observer = new windowObject.MutationObserver(records => {
    const added = new Set();
    for (const record of records) {
      if (record.type === 'characterData') applyTextNode(record.target);
      else if (record.type === 'attributes') applyAttributes(record.target);
      else for (const node of record.addedNodes) added.add(node);
    }
    // Each added subtree is visited once. WebGL/canvas frames and numerical
    // solver updates are not observed, read, patched or scheduled here.
    for (const node of added) if (!added.has(node.parentNode)) applySubtree(node, documentObject);
  });
  observer.observe(documentObject.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ATTRIBUTES
  });

  for (const name of ['alert', 'confirm', 'prompt']) {
    if (typeof windowObject[name] === 'function') {
      const original = windowObject[name].bind(windowObject);
      windowObject[name] = (message, ...args) => original(translateUI(message), ...args);
    }
  }

  windowObject.londonMapLanguage = { get: getLanguage, set: mode => setLanguage(mode, documentObject) };
  return observer;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const start = () => startLanguageUI(document, window);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
