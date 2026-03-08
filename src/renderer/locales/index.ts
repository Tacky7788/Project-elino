import { platform } from '../platform';
// i18n module for eito desktop companion
import { ja } from './ja';
import { en } from './en';

export type Locale = 'ja' | 'en';

const dictionaries: Record<Locale, Record<string, string>> = { ja, en };

let currentLocale: Locale = 'ja';
let dict: Record<string, string> = ja;

/** Get current locale */
export function getLocale(): Locale {
  return currentLocale;
}

/** Translate key with optional template variables {{name}} */
export function t(key: string, vars?: Record<string, string | number>): string {
  let text = dict[key] ?? ja[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/** Initialize i18n from electron-store settings */
export async function initI18n(): Promise<void> {
  try {
    const settings = await platform.getSettings();
    const lang = (settings as any).language as Locale | undefined;
    if (lang && dictionaries[lang]) {
      currentLocale = lang;
      dict = dictionaries[lang];
    }
  } catch {
    // fallback to ja
  }
}

/** Apply translations to all DOM elements with data-i18n attributes */
export function applyDOMTranslations(): void {
  // data-i18n → textContent (or label attribute for optgroup)
  // NOTE: optgroup.textContent への代入は子 option を全削除するため
  //       optgroup は label 属性を更新する
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')!;
    if (el.tagName === 'OPTGROUP') {
      el.setAttribute('label', t(key));
    } else {
      el.textContent = t(key);
    }
  });

  // data-i18n-placeholder → placeholder
  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')!;
    (el as HTMLInputElement).placeholder = t(key);
  });

  // data-i18n-title → title
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')!;
    el.title = t(key);
  });

  // data-i18n-aria-label → aria-label
  document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label')!;
    el.setAttribute('aria-label', t(key));
  });

  // data-i18n-html → innerHTML (for strings with inline elements)
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html')!;
    el.innerHTML = t(key);
  });
}

/** Switch locale, re-translate DOM, save to settings */
export async function switchLocale(locale: Locale): Promise<void> {
  if (!dictionaries[locale]) return;
  currentLocale = locale;
  dict = dictionaries[locale];
  applyDOMTranslations();

  try {
    const settings = await platform.getSettings();
    (settings as any).language = locale;
    await platform.saveSettings(settings);
  } catch {
    // save failed silently
  }
}
