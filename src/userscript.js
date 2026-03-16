import { buildBandcampNote, normalizeBandcampUrl, parseBandcampPageState } from './bandcamp.js';

const NOTE_CLASS = 'red-bandcamp-price-note';
const NOTE_STATUS_CLASS_PREFIX = `${NOTE_CLASS}--`;
const ANNOTATED_ATTR = 'data-red-bandcamp-price-annotated';
const REQUEST_PAGE_MATCH = /^\/requests\.php$/i;
const requestStateCache = new Map();

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

async function getBandcampNote(url) {
  if (!requestStateCache.has(url)) {
    requestStateCache.set(
      url,
      requestBandcampPage(url)
        .then(pageHtml => buildBandcampNote(parseBandcampPageState(pageHtml)))
        .catch(() => ({
          kind: 'error',
          text: 'Bandcamp check failed',
        })),
    );
  }

  return requestStateCache.get(url);
}

function insertNote(anchor, note) {
  const currentText = anchor.getAttribute(ANNOTATED_ATTR);
  if (currentText === note.text) {
    return;
  }

  const existingNote = anchor.nextElementSibling?.classList.contains(NOTE_CLASS)
    ? anchor.nextElementSibling
    : null;
  const noteElement = existingNote ?? document.createElement('span');

  noteElement.className = `${NOTE_CLASS} ${NOTE_STATUS_CLASS_PREFIX}${note.kind}`;
  noteElement.textContent = ` (${note.text})`;

  if (!existingNote) {
    anchor.insertAdjacentElement('afterend', noteElement);
  }

  anchor.setAttribute(ANNOTATED_ATTR, note.text);
}

async function annotateBandcampLinks() {
  const anchors = findBandcampAnchors();
  const urls = [
    ...new Set(anchors.map(anchor => normalizeBandcampUrl(anchor.href)).filter(Boolean)),
  ];

  await Promise.all(urls.map(async url => getBandcampNote(url)));

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
