# RED Bandcamp Price Userscript

[![semantic-release](https://img.shields.io/badge/semantic--release-active-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![CodeQL](../../actions/workflows/codeql.yml/badge.svg)](../../actions/workflows/codeql.yml)

Annotates Bandcamp links on RED request pages with one of four inline notes:

- `€4.00`
- `free digital download`
- `digital preorder, not released yet`
- `no web version sold`

The script scans the request description and comments, fetches each linked Bandcamp page once, and injects the result directly after every Bandcamp link it finds.

You can optionally set a target currency from the Violentmonkey menu. When set, paid releases are shown in that currency instead, for example `~$4.35`, with the original price available in the note tooltip.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw userscript URL:

   `https://raw.githubusercontent.com/tomerh2001/redacted-bandcamp-price-userscript/main/dist/redacted-bandcamp-price.user.js`

3. Confirm the install prompt in Violentmonkey.

## Development

```bash
npm install
npm test
npm run build
```

The build output lands in `dist/redacted-bandcamp-price.user.js`.
