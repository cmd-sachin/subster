# Subster usage (Chrome extension)

Measures how long you spend on the sites of subscriptions you track, so Subster can compare cost
with use on the web as well as on your phone.

- Asks the server which sites belong to tracked subscriptions (`GET /api/usage`).
- Counts time for one of those sites while it is the focused tab and you are active, or while its
  tab is playing sound. A film keeps counting without input; music keeps counting in a background
  tab. Nothing is counted while the screen is locked.
- Sends daily totals per subscription (`POST /api/usage`, source `web`) every 15 minutes and on
  **Sync now**. No page addresses, titles or content are stored or sent.

## Install

1. Start the web app (`npm run dev`) and track at least one subscription.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick this
   `extension/` folder.
3. Open the extension's popup. It lists the sites it measures and today's time for each.

The default server is `http://localhost:3000`. Any other address must be `https://`, and Chrome
asks for permission to reach it when you save it.

## Limits

- Chrome and Chromium browsers only (Edge, Brave, Arc). Safari and Firefox are not covered.
- Desktop apps are invisible to it: Apple Music or Spotify in their own app are not counted.
- Time is credited in steps of at most 90 seconds, so totals are accurate to about a minute.
- A service whose site is shared with other products (GitHub Copilot on github.com, Apple One)
  is not measured, because time on that site says nothing about the subscription.

`npm run test:extension` checks the matching rules; the Chrome parts are checked by hand.
