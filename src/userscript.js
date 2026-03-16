import {
  buildBandcampNote,
  convertAmount,
  formatBandcampPrice,
  normalizeBandcampUrl,
  normalizeCurrencyCode,
  parseBandcampPageState,
  parseEcbExchangeRates,
} from './bandcamp.js';

const DEFAULT_TARGET_CURRENCY = null;
const ECB_DAILY_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const NOTE_CLASS = 'red-bandcamp-price-note';
const NOTE_STATUS_CLASS_PREFIX = `${NOTE_CLASS}--`;
const ANNOTATED_ATTR = 'data-red-bandcamp-price-annotated';
const REQUEST_PAGE_MATCH = /^\/requests\.php$/i;
const TARGET_CURRENCY_STORAGE_KEY = 'targetCurrency';
const requestStateCache = new Map();
let exchangeRatesPromise;

function addStyles() {
  if (document.getElementById('red-bandcamp-price-note-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'red-bandcamp-price-note-styles';
  style.textContent = `
    .${NOTE_CLASS} {
      font-size: 0.92em;
      margin-left: 0.25rem;
      white-space: nowrap;
    }

    .${NOTE_STATUS_CLASS_PREFIX}available {
      color: #2e8b57;
    }

    .${NOTE_STATUS_CLASS_PREFIX}preorder {
      color: #c67a00;
    }

    .${NOTE_STATUS_CLASS_PREFIX}unavailable {
      color: #777;
    }

    .${NOTE_STATUS_CLASS_PREFIX}error {
      color: #b22222;
    }
  `;
  document.head.append(style);
}

function isRequestViewPage() {
  return REQUEST_PAGE_MATCH.test(window.location.pathname) &&
    new URLSearchParams(window.location.search).get('action') === 'view';
}

function findBandcampAnchors() {
  return [...document.querySelectorAll('#content a[href*="bandcamp.com/"]')].filter(anchor => {
    const normalizedUrl = normalizeBandcampUrl(anchor.href);
    return Boolean(normalizedUrl);
  });
}

function requestBandcampPage(url) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 20_000,
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          resolve(response.responseText);
          return;
        }

        reject(new Error(`Bandcamp responded with ${response.status}`));
      },
      ontimeout() {
        reject(new Error('Bandcamp request timed out'));
      },
      onerror() {
        reject(new Error('Bandcamp request failed'));
      },
    });
  });
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 20_000,
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          resolve(response.responseText);
          return;
        }

        reject(new Error(`Request failed with ${response.status}`));
      },
      ontimeout() {
        reject(new Error('Request timed out'));
      },
      onerror() {
        reject(new Error('Request failed'));
      },
    });
  });
}

function getConfiguredTargetCurrency() {
  if (typeof GM_getValue === 'function') {
    return normalizeCurrencyCode(GM_getValue(TARGET_CURRENCY_STORAGE_KEY, DEFAULT_TARGET_CURRENCY));
  }

  return normalizeCurrencyCode(DEFAULT_TARGET_CURRENCY);
}

function setConfiguredTargetCurrency(targetCurrency) {
  if (typeof GM_setValue !== 'function') {
    return;
  }

  GM_setValue(TARGET_CURRENCY_STORAGE_KEY, targetCurrency ?? '');
}

function registerMenuCommands() {
  if (typeof GM_registerMenuCommand !== 'function') {
    return;
  }

  const currentTargetCurrency = getConfiguredTargetCurrency();
  GM_registerMenuCommand(
    `Set target currency (${currentTargetCurrency ?? 'native'})`,
    () => {
      const input = window.prompt(
        'Enter a 3-letter currency code to convert prices to. Leave blank to clear.',
        currentTargetCurrency ?? '',
      );
      if (input === null) {
        return;
      }

      const normalizedCurrency = normalizeCurrencyCode(input);
      if (!input.trim()) {
        setConfiguredTargetCurrency(null);
        window.location.reload();
        return;
      }

      if (!normalizedCurrency) {
        window.alert('Currency codes must look like USD, EUR, GBP, or JPY.');
        return;
      }

      setConfiguredTargetCurrency(normalizedCurrency);
      window.location.reload();
    },
  );

  if (currentTargetCurrency) {
    GM_registerMenuCommand('Clear target currency', () => {
      setConfiguredTargetCurrency(null);
      window.location.reload();
    });
  }
}

async function getExchangeRates() {
  if (!exchangeRatesPromise) {
    exchangeRatesPromise = requestText(ECB_DAILY_RATES_URL).then(parseEcbExchangeRates);
  }

  return exchangeRatesPromise;
}

async function getBandcampPageState(url) {
  if (!requestStateCache.has(url)) {
    requestStateCache.set(
      url,
      requestBandcampPage(url)
        .then(pageHtml => parseBandcampPageState(pageHtml))
        .catch(() => ({
          error: 'Bandcamp check failed',
        })),
    );
  }

  return requestStateCache.get(url);
}

async function buildNoteForPageState(pageState, targetCurrency) {
  if (pageState?.error) {
    return {
      kind: 'error',
      text: pageState.error,
    };
  }

  if (!targetCurrency || !pageState?.priceAmount || !pageState?.priceCurrency) {
    return buildBandcampNote(pageState);
  }

  const sourceCurrency = normalizeCurrencyCode(pageState.priceCurrency);
  if (!sourceCurrency || sourceCurrency === targetCurrency) {
    return buildBandcampNote(pageState);
  }

  try {
    const rates = await getExchangeRates();
    const convertedAmount = convertAmount(pageState.priceAmount, sourceCurrency, targetCurrency, rates);
    if (convertedAmount === null) {
      return buildBandcampNote(pageState);
    }

    return buildBandcampNote(pageState, {
      priceText: `~${formatBandcampPrice(convertedAmount, targetCurrency)}`,
      title: `Converted from ${formatBandcampPrice(pageState.priceAmount, sourceCurrency)} using ECB reference rates`,
    });
  } catch {
    return buildBandcampNote(pageState);
  }
}

function insertNote(anchor, note) {
  const currentText = anchor.getAttribute(ANNOTATED_ATTR);
  if (currentText === note.text) {
    const existingNote = anchor.nextElementSibling?.classList.contains(NOTE_CLASS)
      ? anchor.nextElementSibling
      : null;
    if (note.title) {
      existingNote?.setAttribute('title', note.title);
    } else {
      existingNote?.removeAttribute('title');
    }
    return;
  }

  const existingNote = anchor.nextElementSibling?.classList.contains(NOTE_CLASS)
    ? anchor.nextElementSibling
    : null;
  const noteElement = existingNote ?? document.createElement('span');

  noteElement.className = `${NOTE_CLASS} ${NOTE_STATUS_CLASS_PREFIX}${note.kind}`;
  noteElement.textContent = ` (${note.text})`;
  if (note.title) {
    noteElement.setAttribute('title', note.title);
  } else {
    noteElement.removeAttribute('title');
  }

  if (!existingNote) {
    anchor.insertAdjacentElement('afterend', noteElement);
  }

  anchor.setAttribute(ANNOTATED_ATTR, note.text);
}

async function annotateBandcampLinks() {
  const targetCurrency = getConfiguredTargetCurrency();
  const anchors = findBandcampAnchors();
  const urls = [
    ...new Set(anchors.map(anchor => normalizeBandcampUrl(anchor.href)).filter(Boolean)),
  ];

  const noteCache = new Map();
  await Promise.all(
    urls.map(async url => {
      const pageState = await getBandcampPageState(url);
      noteCache.set(url, await buildNoteForPageState(pageState, targetCurrency));
    }),
  );

  for (const anchor of anchors) {
    const normalizedUrl = normalizeBandcampUrl(anchor.href);
    if (!normalizedUrl) {
      continue;
    }

    const note = noteCache.get(normalizedUrl);
    insertNote(anchor, note);
  }
}

function bootstrap() {
  if (!isRequestViewPage()) {
    return;
  }

  addStyles();
  registerMenuCommands();
  void annotateBandcampLinks();
}

bootstrap();
