// ==UserScript==
// @name         RED Bandcamp Price Userscript
// @namespace    https://github.com/tomerh2001/redacted-bandcamp-price-userscript
// @version      1.2.0
// @description  Annotate RED and OPS request-page Bandcamp links with availability and price details.
// @author       Tomer Horowitz
// @match        https://redacted.sh/requests.php?action=view*
// @match        https://orpheus.network/requests.php?action=view*
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @homepageURL  https://github.com/tomerh2001/redacted-bandcamp-price-userscript
// @supportURL   https://github.com/tomerh2001/redacted-bandcamp-price-userscript/issues
// @downloadURL  https://raw.githubusercontent.com/tomerh2001/redacted-bandcamp-price-userscript/main/dist/redacted-bandcamp-price.user.js
// @updateURL    https://raw.githubusercontent.com/tomerh2001/redacted-bandcamp-price-userscript/main/dist/redacted-bandcamp-price.user.js
// ==/UserScript==
(() => {
  // src/bandcamp.js
  var BANDCAMP_PATH_RE = /^\/(?:album|track)\//i;
  var HTML_TAG_RE = /<[^>]+>/g;
  var TRALBUM_ATTR_RE = /data-tralbum="([^"]+)"/i;
  var CART_ATTR_RE = /data-cart="([^"]+)"/i;
  var DIGITAL_BLOCK_RE = /class="[^"]*\bbuyItem\b[^"]*\bdigital\b[^"]*"/i;
  var DIGITAL_ITEM_RE = /<li\b[^>]*class="[^"]*\bbuyItem\b[^"]*\bdigital\b[^"]*"[^>]*>[\s\S]*?<\/li>/i;
  var DIGITAL_CURRENCY_RE = /class="[^"]*\bbuyItemExtra\b[^"]*\bsecondaryText\b[^"]*">\s*([A-Z]{3})\s*</i;
  var ECB_RATE_RE = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  function normalizeCurrencyCode(rawCurrency) {
    if (typeof rawCurrency !== "string") {
      return null;
    }
    const normalizedCurrency = rawCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      return null;
    }
    return normalizedCurrency;
  }
  function normalizeBandcampUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!parsed.hostname.toLowerCase().endsWith(".bandcamp.com")) {
        return null;
      }
      const cleanedPath = parsed.pathname.replace(/\/+$/, "");
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
      return "";
    }
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = value;
      return textarea.value;
    }
    return value.replaceAll("&quot;", '"').replaceAll("&#34;", '"').replaceAll("&#39;", "'").replaceAll("&apos;", "'").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
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
    const digitalBlock = DIGITAL_ITEM_RE.exec(pageHtml)?.[0] ?? "";
    const fromDigitalBlock = DIGITAL_CURRENCY_RE.exec(digitalBlock)?.[1];
    if (fromDigitalBlock) {
      return normalizeCurrencyCode(fromDigitalBlock);
    }
    const fromPage = DIGITAL_CURRENCY_RE.exec(pageHtml)?.[1];
    if (fromPage) {
      return normalizeCurrencyCode(fromPage);
    }
    const cartCurrency = parseCartData(pageHtml)?.currency;
    if (typeof cartCurrency === "string" && cartCurrency.trim()) {
      return normalizeCurrencyCode(cartCurrency);
    }
    return null;
  }
  function parseDigitalPriceAmount(tralbum) {
    const current = tralbum?.current ?? {};
    for (const key of ["minimum_price", "minimum_price_nonzero", "set_price"]) {
      const value = current[key];
      if (value === null || value === void 0 || value === "") {
        continue;
      }
      const amount = Number(value);
      if (!Number.isNaN(amount)) {
        return amount;
      }
    }
    return null;
  }
  function parseBandcampPageState(pageHtml) {
    const tralbum = parseTralbumData(pageHtml);
    const hasDigitalDownload = DIGITAL_BLOCK_RE.test(pageHtml);
    const isPreorder = Boolean(
      hasDigitalDownload && (tralbum?.is_preorder || tralbum?.album_is_preorder || tralbum?.download_is_preorder || tralbum?.current?.album_is_preorder || tralbum?.current?.download_is_preorder)
    );
    return {
      hasDigitalDownload,
      availableNow: hasDigitalDownload && !isPreorder,
      isPreorder,
      priceAmount: hasDigitalDownload ? parseDigitalPriceAmount(tralbum) : null,
      priceCurrency: hasDigitalDownload ? parseDigitalCurrency(pageHtml) : null,
      pageText: decodeHtmlEntities(pageHtml.replace(HTML_TAG_RE, " "))
    };
  }
  function formatBandcampPrice(amount, currency) {
    if (amount === null || amount === void 0) {
      return null;
    }
    const normalizedAmount = Number(amount);
    if (Number.isNaN(normalizedAmount)) {
      return null;
    }
    const normalizedCurrency = normalizeCurrencyCode(currency) ?? "";
    if (normalizedCurrency) {
      try {
        return new Intl.NumberFormat("en", {
          style: "currency",
          currency: normalizedCurrency,
          currencyDisplay: "narrowSymbol",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(normalizedAmount);
      } catch {
        return `${normalizedCurrency} ${normalizedAmount.toFixed(2)}`;
      }
    }
    return normalizedAmount.toFixed(2);
  }
  function parseEcbExchangeRates(xmlText) {
    const rates = {
      EUR: 1
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
  function convertAmount(amount, fromCurrency, toCurrency, rates) {
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
    const sourceRate = sourceCurrency === "EUR" ? 1 : Number(rates[sourceCurrency]);
    const targetRate = targetCurrency === "EUR" ? 1 : Number(rates[targetCurrency]);
    if (Number.isNaN(sourceRate) || Number.isNaN(targetRate) || sourceRate <= 0 || targetRate <= 0) {
      return null;
    }
    return normalizedAmount / sourceRate * targetRate;
  }
  function buildBandcampNote(pageState, options = {}) {
    if (!pageState.hasDigitalDownload) {
      return {
        kind: "unavailable",
        text: "no web version sold"
      };
    }
    if (pageState.isPreorder) {
      return {
        kind: "preorder",
        text: "digital preorder, not released yet"
      };
    }
    if (pageState.priceAmount === 0) {
      return {
        kind: "available",
        text: "free digital download"
      };
    }
    const formattedPrice = typeof options.priceText === "string" && options.priceText.trim() || formatBandcampPrice(pageState.priceAmount, pageState.priceCurrency);
    const note = {
      kind: "available",
      text: formattedPrice || "version available"
    };
    if (typeof options.title === "string" && options.title.trim()) {
      note.title = options.title.trim();
    }
    return note;
  }

  // src/userscript.js
  var DEFAULT_TARGET_CURRENCY = null;
  var ECB_DAILY_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
  var NOTE_CLASS = "red-bandcamp-price-note";
  var NOTE_STATUS_CLASS_PREFIX = `${NOTE_CLASS}--`;
  var ANNOTATED_ATTR = "data-red-bandcamp-price-annotated";
  var REQUEST_PAGE_MATCH = /^\/requests\.php$/i;
  var TARGET_CURRENCY_STORAGE_KEY = "targetCurrency";
  var requestStateCache = /* @__PURE__ */ new Map();
  var exchangeRatesPromise;
  function addStyles() {
    if (document.getElementById("red-bandcamp-price-note-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "red-bandcamp-price-note-styles";
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
    return REQUEST_PAGE_MATCH.test(window.location.pathname) && new URLSearchParams(window.location.search).get("action") === "view";
  }
  function findBandcampAnchors() {
    return [...document.querySelectorAll('#content a[href*="bandcamp.com/"]')].filter((anchor) => {
      const normalizedUrl = normalizeBandcampUrl(anchor.href);
      return Boolean(normalizedUrl);
    });
  }
  function requestBandcampPage(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 2e4,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`Bandcamp responded with ${response.status}`));
        },
        ontimeout() {
          reject(new Error("Bandcamp request timed out"));
        },
        onerror() {
          reject(new Error("Bandcamp request failed"));
        }
      });
    });
  }
  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 2e4,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`Request failed with ${response.status}`));
        },
        ontimeout() {
          reject(new Error("Request timed out"));
        },
        onerror() {
          reject(new Error("Request failed"));
        }
      });
    });
  }
  function getConfiguredTargetCurrency() {
    if (typeof GM_getValue === "function") {
      return normalizeCurrencyCode(GM_getValue(TARGET_CURRENCY_STORAGE_KEY, DEFAULT_TARGET_CURRENCY));
    }
    return normalizeCurrencyCode(DEFAULT_TARGET_CURRENCY);
  }
  function setConfiguredTargetCurrency(targetCurrency) {
    if (typeof GM_setValue !== "function") {
      return;
    }
    GM_setValue(TARGET_CURRENCY_STORAGE_KEY, targetCurrency ?? "");
  }
  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") {
      return;
    }
    const currentTargetCurrency = getConfiguredTargetCurrency();
    GM_registerMenuCommand(
      `Set target currency (${currentTargetCurrency ?? "native"})`,
      () => {
        const input = window.prompt(
          "Enter a 3-letter currency code to convert prices to. Leave blank to clear.",
          currentTargetCurrency ?? ""
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
          window.alert("Currency codes must look like USD, EUR, GBP, or JPY.");
          return;
        }
        setConfiguredTargetCurrency(normalizedCurrency);
        window.location.reload();
      }
    );
    if (currentTargetCurrency) {
      GM_registerMenuCommand("Clear target currency", () => {
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
        requestBandcampPage(url).then((pageHtml) => parseBandcampPageState(pageHtml)).catch(() => ({
          error: "Bandcamp check failed"
        }))
      );
    }
    return requestStateCache.get(url);
  }
  async function buildNoteForPageState(pageState, targetCurrency) {
    if (pageState?.error) {
      return {
        kind: "error",
        text: pageState.error
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
        title: `Converted from ${formatBandcampPrice(pageState.priceAmount, sourceCurrency)} using ECB reference rates`
      });
    } catch {
      return buildBandcampNote(pageState);
    }
  }
  function insertNote(anchor, note) {
    const currentText = anchor.getAttribute(ANNOTATED_ATTR);
    if (currentText === note.text) {
      const existingNote2 = anchor.nextElementSibling?.classList.contains(NOTE_CLASS) ? anchor.nextElementSibling : null;
      if (note.title) {
        existingNote2?.setAttribute("title", note.title);
      } else {
        existingNote2?.removeAttribute("title");
      }
      return;
    }
    const existingNote = anchor.nextElementSibling?.classList.contains(NOTE_CLASS) ? anchor.nextElementSibling : null;
    const noteElement = existingNote ?? document.createElement("span");
    noteElement.className = `${NOTE_CLASS} ${NOTE_STATUS_CLASS_PREFIX}${note.kind}`;
    noteElement.textContent = ` (${note.text})`;
    if (note.title) {
      noteElement.setAttribute("title", note.title);
    } else {
      noteElement.removeAttribute("title");
    }
    if (!existingNote) {
      anchor.insertAdjacentElement("afterend", noteElement);
    }
    anchor.setAttribute(ANNOTATED_ATTR, note.text);
  }
  async function annotateBandcampLinks() {
    const targetCurrency = getConfiguredTargetCurrency();
    const anchors = findBandcampAnchors();
    const urls = [
      ...new Set(anchors.map((anchor) => normalizeBandcampUrl(anchor.href)).filter(Boolean))
    ];
    const noteCache = /* @__PURE__ */ new Map();
    await Promise.all(
      urls.map(async (url) => {
        const pageState = await getBandcampPageState(url);
        noteCache.set(url, await buildNoteForPageState(pageState, targetCurrency));
      })
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
})();
