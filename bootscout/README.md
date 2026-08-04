# BootScout

BootScout is a mobile-first installable web app for valuing items quickly at UK car boot sales.

## What it does

- Captures an item photo from the rear camera.
- Reads barcodes, packaging text and an optional on-device visual hint.
- Opens eBay UK with **Sold items** and **Completed items** already selected.
- Links to active-market comparisons on Vinted, CeX, Etsy, Amazon, Facebook Marketplace, Google Shopping and Discogs.
- Records close sold comparisons and calculates low, median and high values.
- Calculates expected profit, ROI and a maximum sensible buy price.
- Saves finds, photos and notes locally with IndexedDB.
- Exports saved finds as CSV.
- Includes fast category-specific inspection checklists.
- Works as a PWA and caches the app shell for weak-signal situations.

## Install on iPhone

Open the hosted page in Safari, tap Share, choose **Add to Home Screen**, then tap Add.

## Important pricing note

The public eBay search URL supports completed/sold filters. eBay's official sales-history API is limited release, so this app intentionally does not scrape or pretend to have a private sold-price feed. It opens the official result page and lets the user record the closest genuine comparisons. Other marketplace buttons are asking-price checks, not confirmed sales.

## Privacy

Photos and saved finds stay in the browser's local storage/IndexedDB. OCR and the optional visual model are loaded from jsDelivr when selected; no photo is uploaded by BootScout itself.
