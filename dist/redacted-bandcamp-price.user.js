// ==UserScript==
// @name         RED Bandcamp Price Userscript
// @namespace    https://github.com/tomerh2001/redacted-bandcamp-price-userscript
// @version      1.0.0
// @description  Annotate RED request-page Bandcamp links with digital availability and price details.
// @author       Tomer Horowitz
// @match        https://redacted.sh/requests.php?action=view*
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
      return fromDigitalBlock.toUpperCase();
    }
    const fromPage = DIGITAL_CURRENCY_RE.exec(pageHtml)?.[1];
    if (fromPage) {
      return fromPage.toUpperCase();
    }
    const cartCurrency = parseCartData(pageHtml)?.currency;
    if (typeof cartCurrency === "string" && cartCurrency.trim()) {
      return cartCurrency.trim().toUpperCase();
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
    const normalizedCurrency = typeof currency === "string" ? currency.trim().toUpperCase() : "";
    if (normalizedCurrency === "USD") {
      return `USD ${normalizedAmount.toFixed(2)}`;
    }
    if (normalizedCurrency) {
      return `${normalizedCurrency} ${normalizedAmount.toFixed(2)}`;
    }
    return normalizedAmount.toFixed(2);
  }
  function buildBandcampNote(pageState) {
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
    const formattedPrice = formatBandcampPrice(pageState.priceAmount, pageState.priceCurrency);
    return {
      kind: "available",
      text: formattedPrice ? `digital ${formattedPrice}` : "digital version available"
    };
  }

  // src/userscript.js
  var NOTE_CLASS = "red-bandcamp-price-note";
  var NOTE_STATUS_CLASS_PREFIX = `${NOTE_CLASS}--`;
  var ANNOTATED_ATTR = "data-red-bandcamp-price-annotated";
  var REQUEST_PAGE_MATCH = /^\/requests\.php$/i;
  var requestStateCache = /* @__PURE__ */ new Map();
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
  async function getBandcampNote(url) {
    if (!requestStateCache.has(url)) {
      requestStateCache.set(
        url,
        requestBandcampPage(url).then((pageHtml) => buildBandcampNote(parseBandcampPageState(pageHtml))).catch(() => ({
          kind: "error",
          text: "Bandcamp check failed"
        }))
      );
    }
    return requestStateCache.get(url);
  }
  function insertNote(anchor, note) {
    const currentText = anchor.getAttribute(ANNOTATED_ATTR);
    if (currentText === note.text) {
      return;
    }
    const existingNote = anchor.nextElementSibling?.classList.contains(NOTE_CLASS) ? anchor.nextElementSibling : null;
    const noteElement = existingNote ?? document.createElement("span");
    noteElement.className = `${NOTE_CLASS} ${NOTE_STATUS_CLASS_PREFIX}${note.kind}`;
    noteElement.textContent = ` (${note.text})`;
    if (!existingNote) {
      anchor.insertAdjacentElement("afterend", noteElement);
    }
    anchor.setAttribute(ANNOTATED_ATTR, note.text);
  }
  async function annotateBandcampLinks() {
    const anchors = findBandcampAnchors();
    const urls = [
      ...new Set(anchors.map((anchor) => normalizeBandcampUrl(anchor.href)).filter(Boolean))
    ];
    await Promise.all(urls.map(async (url) => getBandcampNote(url)));
    for (const anchor of anchors) {
      const normalizedUrl = normalizeBandcampUrl(anchor.href);
      if (!normalizedUrl) {
        continue;
      }
      const note = await getBandcampNote(normalizedUrl);
      insertNote(anchor, note);
    }
  }
  function bootstrap() {
    if (!isRequestViewPage()) {
      return;
    }
    addStyles();
    void annotateBandcampLinks();
  }
  bootstrap();
})();
