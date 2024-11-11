# Tab Grid Extension

Shows your tabs in a grid on the new tab page. Includes thumbnails of each tab and keyboard shortcuts for saving tabs.

## Installation

```bash
git clone git@github.com:sliftist/ext-tabs.git
cd ext-tabs
yarn install
yarn build
```
Then load in Chrome:
- Go to `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked" 
- Select the `extension` folder

## Development

Run `yarn watch` to automatically rebuild when source files change.

Any pull requests (especially design related) are very much encouraged! I recommend starting by reading `Layout.tsx` and `TabPage.tsx`. Backend data and the service worker is managed by `TabState.tsx`.