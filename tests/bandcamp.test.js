import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBandcampNote,
  convertAmount,
  normalizeBandcampUrl,
  parseBandcampPageState,
} from '../src/bandcamp.js';

function buildBandcampFixture({
  currency = 'USD',
  minimumPrice = 5,
  hasDigitalDownload = true,
  isPreorder = false,
}) {
  const tralbum = JSON.stringify({
    current: {
      minimum_price: minimumPrice,
      minimum_price_nonzero: minimumPrice > 0 ? minimumPrice : null,
      set_price: minimumPrice > 0 ? minimumPrice + 2 : 0,
    },
    is_preorder: isPreorder,
    album_is_preorder: isPreorder,
    download_is_preorder: isPreorder,
  })
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');

  const digitalMarkup = hasDigitalDownload
    ? `
      <li class="buyItem digital">
        <div class="digitaldescription secondaryText">Streaming + Download</div>
        <span class="buyItemExtra secondaryText">${currency}</span>
      </li>
    `
    : `
      <li class="buyItem physical merch">
        <div class="secondaryText">Vinyl only</div>
      </li>
    `;

  return `
    <html>
      <body>
        <script data-tralbum="${tralbum}" data-cart="{&quot;currency&quot;:&quot;${currency}&quot;}"></script>
        ${digitalMarkup}
      </body>
    </html>
  `;
}

test('normalizeBandcampUrl keeps album and track pages only', () => {
  assert.equal(
    normalizeBandcampUrl('https://artist.bandcamp.com/album/sample-release?from=fanpub_fnb'),
    'https://artist.bandcamp.com/album/sample-release',
  );
  assert.equal(
    normalizeBandcampUrl('https://artist.bandcamp.com/track/sample-track/'),
    'https://artist.bandcamp.com/track/sample-track',
  );
  assert.equal(normalizeBandcampUrl('https://bandcamp.com/tag/ambient'), null);
});

test('buildBandcampNote returns a digital price when the download is available now', () => {
  const pageState = parseBandcampPageState(
    buildBandcampFixture({
      currency: 'EUR',
      minimumPrice: 4,
      hasDigitalDownload: true,
      isPreorder: false,
    }),
  );

  assert.deepEqual(buildBandcampNote(pageState), {
    kind: 'available',
    text: 'EUR 4.00',
  });
});

test('buildBandcampNote uses a custom price label when one is provided', () => {
  const pageState = parseBandcampPageState(
    buildBandcampFixture({
      currency: 'EUR',
      minimumPrice: 4,
      hasDigitalDownload: true,
      isPreorder: false,
    }),
  );

  assert.deepEqual(buildBandcampNote(pageState, {
    priceText: '~USD 4.35',
    title: 'Converted from EUR 4.00',
  }), {
    kind: 'available',
    text: '~USD 4.35',
    title: 'Converted from EUR 4.00',
  });
});

test('buildBandcampNote recognizes free downloads', () => {
  const pageState = parseBandcampPageState(
    buildBandcampFixture({
      minimumPrice: 0,
      hasDigitalDownload: true,
      isPreorder: false,
    }),
  );

  assert.deepEqual(buildBandcampNote(pageState), {
    kind: 'available',
    text: 'free digital download',
  });
});

test('buildBandcampNote marks digital preorders', () => {
  const pageState = parseBandcampPageState(
    buildBandcampFixture({
      currency: 'GBP',
      minimumPrice: 9,
      hasDigitalDownload: true,
      isPreorder: true,
    }),
  );

  assert.deepEqual(buildBandcampNote(pageState), {
    kind: 'preorder',
    text: 'digital preorder, not released yet',
  });
});

test('buildBandcampNote reports when no web version is sold', () => {
  const pageState = parseBandcampPageState(
    buildBandcampFixture({
      hasDigitalDownload: false,
    }),
  );

  assert.deepEqual(buildBandcampNote(pageState), {
    kind: 'unavailable',
    text: 'no web version sold',
  });
});

test('convertAmount converts via ECB-style rates', () => {
  assert.equal(
    convertAmount(4, 'EUR', 'USD', { EUR: 1, USD: 1.2 }),
    4.8,
  );
  assert.equal(
    convertAmount(6, 'USD', 'GBP', { EUR: 1, USD: 1.2, GBP: 0.8 }),
    4,
  );
});
