const BANDCAMP_PATH_RE = /^\/(?:album|track)\//i;
const HTML_TAG_RE = /<[^>]+>/g;
const TRALBUM_ATTR_RE = /data-tralbum="([^"]+)"/i;
const CART_ATTR_RE = /data-cart="([^"]+)"/i;
const DIGITAL_BLOCK_RE = /class="[^"]*\bbuyItem\b[^"]*\bdigital\b[^"]*"/i;
const DIGITAL_ITEM_RE =
  /<li\b[^>]*class="[^"]*\bbuyItem\b[^"]*\bdigital\b[^"]*"[^>]*>[\s\S]*?<\/li>/i;
const DIGITAL_CURRENCY_RE =
  /class="[^"]*\bbuyItemExtra\b[^"]*\bsecondaryText\b[^"]*">\s*([A-Z]{3})\s*</i;
const ECB_RATE_RE = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;

export function normalizeCurrencyCode(rawCurrency) {
  if (typeof rawCurrency !== 'string') {
    return null;
  }

  const normalizedCurrency = rawCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    return null;
  }

  return normalizedCurrency;
}

export function normalizeBandcampUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.hostname.toLowerCase().endsWith('.bandcamp.com')) {
      return null;
    }

    const cleanedPath = parsed.pathname.replace(/\/+$/, '');
    if (!BANDCAMP_PATH_RE.test(`${cleanedPath}/`)) {
      return null;
    }

    return `${parsed.origin}${cleanedPath}`;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }

  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }

  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#34;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function parseEmbeddedJson(pageHtml, pattern) {
  const match = pattern.exec(pageHtml);
  if (!match) {
    return null;
  }

  try {
    return JSON.parse(decodeHtmlEntities(match[1]));
  } catch {
    return null;
  }
}

function parseTralbumData(pageHtml) {
  return parseEmbeddedJson(pageHtml, TRALBUM_ATTR_RE);
}

function parseCartData(pageHtml) {
  return parseEmbeddedJson(pageHtml, CART_ATTR_RE);
}

function parseDigitalCurrency(pageHtml) {
  const digitalBlock = DIGITAL_ITEM_RE.exec(pageHtml)?.[0] ?? '';
  const fromDigitalBlock = DIGITAL_CURRENCY_RE.exec(digitalBlock)?.[1];
  if (fromDigitalBlock) {
    return normalizeCurrencyCode(fromDigitalBlock);
  }

  const fromPage = DIGITAL_CURRENCY_RE.exec(pageHtml)?.[1];
  if (fromPage) {
    return normalizeCurrencyCode(fromPage);
  }

  const cartCurrency = parseCartData(pageHtml)?.currency;
  if (typeof cartCurrency === 'string' && cartCurrency.trim()) {
    return normalizeCurrencyCode(cartCurrency);
  }

  return null;
}

function parseDigitalPriceAmount(tralbum) {
  const current = tralbum?.current ?? {};
  for (const key of ['minimum_price', 'minimum_price_nonzero', 'set_price']) {
    const value = current[key];
    if (value === null || value === undefined || value === '') {
      continue;
    }

    const amount = Number(value);
    if (!Number.isNaN(amount)) {
      return amount;
    }
  }

  return null;
}

export function parseBandcampPageState(pageHtml) {
  const tralbum = parseTralbumData(pageHtml);
  const hasDigitalDownload = DIGITAL_BLOCK_RE.test(pageHtml);
  const isPreorder = Boolean(
    hasDigitalDownload &&
      (tralbum?.is_preorder ||
        tralbum?.album_is_preorder ||
        tralbum?.download_is_preorder ||
        tralbum?.current?.album_is_preorder ||
        tralbum?.current?.download_is_preorder),
  );

  return {
    hasDigitalDownload,
    availableNow: hasDigitalDownload && !isPreorder,
    isPreorder,
    priceAmount: hasDigitalDownload ? parseDigitalPriceAmount(tralbum) : null,
    priceCurrency: hasDigitalDownload ? parseDigitalCurrency(pageHtml) : null,
    pageText: decodeHtmlEntities(pageHtml.replace(HTML_TAG_RE, ' ')),
  };
}

export function formatBandcampPrice(amount, currency) {
  if (amount === null || amount === undefined) {
    return null;
  }

  const normalizedAmount = Number(amount);
  if (Number.isNaN(normalizedAmount)) {
    return null;
  }

  const normalizedCurrency = normalizeCurrencyCode(currency) ?? '';
  if (normalizedCurrency) {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: normalizedCurrency,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(normalizedAmount);
    } catch {
      return `${normalizedCurrency} ${normalizedAmount.toFixed(2)}`;
    }
  }

  return normalizedAmount.toFixed(2);
}

export function parseEcbExchangeRates(xmlText) {
  const rates = {
    EUR: 1,
  };

  for (const match of xmlText.matchAll(ECB_RATE_RE)) {
    const currency = normalizeCurrencyCode(match[1]);
    const rate = Number(match[2]);
    if (!currency || Number.isNaN(rate) || rate <= 0) {
      continue;
    }

    rates[currency] = rate;
  }

  return rates;
}

export function convertAmount(amount, fromCurrency, toCurrency, rates) {
  const normalizedAmount = Number(amount);
  if (Number.isNaN(normalizedAmount) || normalizedAmount < 0) {
    return null;
  }

  const sourceCurrency = normalizeCurrencyCode(fromCurrency);
  const targetCurrency = normalizeCurrencyCode(toCurrency);
  if (!sourceCurrency || !targetCurrency) {
    return null;
  }

  if (sourceCurrency === targetCurrency) {
    return normalizedAmount;
  }

  const sourceRate = sourceCurrency === 'EUR' ? 1 : Number(rates[sourceCurrency]);
  const targetRate = targetCurrency === 'EUR' ? 1 : Number(rates[targetCurrency]);
  if (Number.isNaN(sourceRate) || Number.isNaN(targetRate) || sourceRate <= 0 || targetRate <= 0) {
    return null;
  }

  return (normalizedAmount / sourceRate) * targetRate;
}

export function buildBandcampNote(pageState, options = {}) {
  if (!pageState.hasDigitalDownload) {
    return {
      kind: 'unavailable',
      text: 'no web version sold',
    };
  }

  if (pageState.isPreorder) {
    return {
      kind: 'preorder',
      text: 'digital preorder, not released yet',
    };
  }

  if (pageState.priceAmount === 0) {
    return {
      kind: 'available',
      text: 'free digital download',
    };
  }

  const formattedPrice =
    (typeof options.priceText === 'string' && options.priceText.trim()) ||
    formatBandcampPrice(pageState.priceAmount, pageState.priceCurrency);
  const note = {
    kind: 'available',
    text: formattedPrice || 'version available',
  };
  if (typeof options.title === 'string' && options.title.trim()) {
    note.title = options.title.trim();
  }
  return note;
}
