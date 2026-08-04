(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
  const SETTINGS_KEY = 'bootscout:settings:v1';
  const QUEUE_KEY = 'bootscout:queue:v1';
  const DB_NAME = 'bootscout-db';
  const DB_VERSION = 1;
  const STORE = 'finds';

  const state = {
    photo: '',
    thumb: '',
    query: '',
    condition: 'Good',
    comps: [],
    suggestions: [],
    deferredInstall: null,
    db: null,
    model: null,
    settings: loadSettings()
  };

  const checklists = {
    general: [
      'Match the exact brand, model, size, edition and quantity to the sold listings.',
      'Check every side for cracks, repairs, missing parts, smells, stains and owner markings.',
      'Ask whether it works and whether you can test it before paying.',
      'Photograph serial numbers, labels and included accessories.',
      'Base the offer on a typical sold price, not the highest result.'
    ],
    electronics: [
      'Power it on and test buttons, screen, speakers, ports, Wi-Fi and charging.',
      'Check for account locks, activation locks, passwords and parental controls.',
      'Inspect the battery for swelling, corrosion or rapid drain.',
      'Confirm the exact model number, storage size, region and included charger.',
      'Look for liquid indicators, damaged screws or signs of a rough repair.'
    ],
    games: [
      'Check the disc closely under light for deep circular scratches or cracks.',
      'Confirm the correct disc is inside and note manuals, maps, inserts and codes.',
      'For consoles, test HDMI, controller sync, disc drive, Wi-Fi and account removal.',
      'Check region, edition, age rating and whether it is a reprint or bundle copy.',
      'Compare complete and loose sold prices separately.'
    ],
    toys: [
      'Count accessories, weapons, stands, cards, instructions and packaging inserts.',
      'Check joints, battery compartments, electronics, paint rub and sun fading.',
      'Compare markings and copyright dates with genuine examples.',
      'Look for reproduction stickers, recasts, reseals or replacement boxes.',
      'Search the exact character, wave, set number and year.'
    ],
    clothing: [
      'Check the size tag, care label, product code and country of manufacture.',
      'Inspect soles, heels, cuffs, collars, zips, seams and high-wear areas.',
      'Look for odour, mould, stains, stretching and hidden repairs.',
      'Compare logo stitching, fonts, hardware and label layout with genuine examples.',
      'Use actual measurements; tagged size alone may not match sold listings.'
    ],
    media: [
      'Check edition, pressing, ISBN/catalogue number, year and country.',
      'Inspect discs or records in strong angled light and check playback where possible.',
      'Look for writing, water damage, loose pages, foxing, mould and smoke smell.',
      'Confirm inserts, dust jackets, posters, sleeves and bonus discs.',
      'For vinyl, compare matrix/runout numbers when the value is high.'
    ],
    tools: [
      'Check the exact model, voltage, battery platform and generation.',
      'Test under load, not only whether the motor spins.',
      'Inspect cables, guards, chucks, switches, bearings and battery terminals.',
      'Confirm batteries and chargers are genuine and hold charge.',
      'Avoid equipment with removed serial labels or unsafe modifications.'
    ]
  };

  const markets = [
    { name: 'eBay active', detail: 'Current asking prices', url: q => `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_PrefLoc=1&_sop=15` },
    { name: 'Vinted', detail: 'Clothes, toys and games', url: q => `https://www.vinted.co.uk/catalog?search_text=${encodeURIComponent(q)}` },
    { name: 'CeX', detail: 'Tech and games trade price', url: q => `https://uk.webuy.com/search?stext=${encodeURIComponent(q)}` },
    { name: 'Etsy', detail: 'Vintage and handmade', url: q => `https://www.etsy.com/uk/search?q=${encodeURIComponent(q)}` },
    { name: 'Amazon', detail: 'New replacement price', url: q => `https://www.amazon.co.uk/s?k=${encodeURIComponent(q)}` },
    { name: 'Google Shopping', detail: 'Broad price check', url: q => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}` },
    { name: 'Facebook Marketplace', detail: 'Local asking prices', url: q => `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(q)}` },
    { name: 'Discogs', detail: 'Vinyl and music media', url: q => `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=all` }
  ];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    renderMarkets();
    renderChecklist('general');
    applySettingsToUI();
    setOnlineState();
    await openDB();
    await renderFinds();
    calculate();
    registerServiceWorker();
    handleLaunchQuery();
  }

  function bindEvents() {
    $('#cameraButton').addEventListener('click', () => $('#photoInput').click());
    $('#photoInput').addEventListener('change', event => handlePhoto(event.target.files?.[0]));
    $('#resetScanButton').addEventListener('click', resetScan);
    $('#quickSearchForm').addEventListener('submit', event => {
      event.preventDefault();
      openEbaySold($('#quickQuery').value);
    });
    $('#ebaySoldButton').addEventListener('click', () => openEbaySold($('#itemQuery').value));
    $('#barcodeButton').addEventListener('click', scanBarcode);
    $('#ocrButton').addEventListener('click', readText);
    $('#visualButton').addEventListener('click', visualGuess);
    $('#clearQueryButton').addEventListener('click', () => updateQuery(''));
    $('#itemQuery').addEventListener('input', event => { state.query = event.target.value; });
    $$('.condition-row button').forEach(button => button.addEventListener('click', () => selectCondition(button.dataset.condition)));
    $('#compForm').addEventListener('submit', addComp);
    ['buyPrice', 'salePrice', 'postagePrice', 'feePercent', 'otherCosts', 'targetProfit'].forEach(id => $(`#${id}`).addEventListener('input', calculate));
    $('#saveFindButton').addEventListener('click', saveFind);
    $('#shareFindButton').addEventListener('click', shareCurrent);
    $('#findSearch').addEventListener('input', renderFinds);
    $('#exportButton').addEventListener('click', exportFinds);
    $('#categorySelect').addEventListener('change', event => renderChecklist(event.target.value));
    $('#saveSettingsButton').addEventListener('click', saveSettingsFromUI);
    $('#installButton').addEventListener('click', showInstall);
    $$('.modal-close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.go)));
    $$('.bottom-nav button').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    window.addEventListener('online', () => { setOnlineState(); announceQueue(); });
    window.addEventListener('offline', setOnlineState);
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.deferredInstall = event;
      $('#installButton').hidden = false;
    });
    window.addEventListener('appinstalled', () => showToast('BootScout installed'));
  }

  function handleLaunchQuery() {
    const params = new URLSearchParams(location.search);
    if (params.get('scan') === '1') setTimeout(() => $('#photoInput').click(), 450);
    if (params.get('tab') === 'finds') switchView('finds');
  }

  function switchView(name) {
    $$('.view').forEach(view => view.classList.remove('active'));
    $(`#${name}View`)?.classList.add('active');
    $$('.bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'finds') renderFinds();
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handlePhoto(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      setAnalysisStatus('Preparing photo…');
      const [photo, thumb] = await Promise.all([
        resizeImage(file, 1400, .82),
        resizeImage(file, 420, .68)
      ]);
      state.photo = photo;
      state.thumb = thumb;
      state.comps = [];
      state.suggestions = [];
      $('#itemPreview').src = photo;
      $('#scanWorkspace').classList.remove('hidden');
      renderComps();
      updateQuery('');
      setAnalysisStatus('Photo ready — label or barcode works best');
      $('#scanWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
      if ('BarcodeDetector' in window) quickNativeBarcode();
    } catch (error) {
      console.error(error);
      showToast('Could not open that photo');
    } finally {
      $('#photoInput').value = '';
    }
  }

  function resizeImage(file, maxDimension, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const image = new Image();
        image.onerror = reject;
        image.onload = () => {
          const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function quickNativeBarcode() {
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      const detector = new BarcodeDetector({ formats });
      const results = await detector.detect($('#itemPreview'));
      if (results[0]?.rawValue) applyBarcode(results[0].rawValue, false);
    } catch (_) {}
  }

  async function scanBarcode() {
    if (!state.photo) return showToast('Take a photo first');
    setBusy('#barcodeButton', true);
    setAnalysisStatus('Looking for a barcode…');
    try {
      let code = '';
      if ('BarcodeDetector' in window) {
        const formats = await BarcodeDetector.getSupportedFormats();
        const detector = new BarcodeDetector({ formats });
        const results = await detector.detect($('#itemPreview'));
        code = results[0]?.rawValue || '';
      }
      if (!code) {
        const zxing = await import('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
        const reader = new zxing.BrowserMultiFormatReader();
        const result = await reader.decodeFromImageUrl(state.photo);
        code = result?.getText?.() || result?.text || '';
      }
      if (!code) throw new Error('No barcode found');
      await applyBarcode(code, true);
    } catch (error) {
      console.warn(error);
      setAnalysisStatus('No barcode found — fill the frame with the label');
      showToast('No barcode found. Try a closer, straighter photo.');
    } finally {
      setBusy('#barcodeButton', false);
    }
  }

  async function applyBarcode(code, announce = true) {
    addSuggestion(`Barcode ${code}`);
    updateQuery(code);
    setAnalysisStatus(`Barcode found: ${code}`);
    if (navigator.onLine) {
      try {
        const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
        if (response.ok) {
          const data = await response.json();
          const item = data.items?.[0];
          if (item) {
            const title = [item.brand, item.title, item.model].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (title) {
              updateQuery(title);
              addSuggestion(item.brand || 'Product matched');
              setAnalysisStatus('Product matched from barcode');
            }
          }
        }
      } catch (_) {}
    }
    if (announce) showToast(`Barcode: ${code}`);
  }

  async function readText() {
    if (!state.photo) return showToast('Take a photo first');
    if (!navigator.onLine && !window.Tesseract) return showToast('OCR needs a connection the first time');
    setBusy('#ocrButton', true);
    setAnalysisStatus('Loading label reader…');
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', 'Tesseract');
      const result = await window.Tesseract.recognize(state.photo, 'eng', {
        logger: message => {
          if (message.status === 'recognizing text') setAnalysisStatus(`Reading label… ${Math.round((message.progress || 0) * 100)}%`);
        }
      });
      const raw = result?.data?.text || '';
      const useful = extractUsefulText(raw);
      if (!useful) throw new Error('No useful text');
      updateQuery(useful);
      useful.split(' ').slice(0, 4).forEach(addSuggestion);
      setAnalysisStatus('Label text added — remove anything irrelevant');
      showToast('Label text added to the search');
    } catch (error) {
      console.error(error);
      setAnalysisStatus('Could not read useful text');
      showToast('Try a closer photo in brighter light');
    } finally {
      setBusy('#ocrButton', false);
    }
  }

  function extractUsefulText(raw) {
    const stop = new Set(['made', 'china', 'warning', 'caution', 'please', 'keep', 'away', 'children', 'recycle', 'www', 'http', 'copyright', 'registered', 'trademark', 'model', 'number', 'serial', 'input', 'output', 'voltage']);
    const lines = raw.split(/\n+/).map(line => line.replace(/[^a-zA-Z0-9&+./' -]/g, ' ').replace(/\s+/g, ' ').trim()).filter(line => line.length >= 2 && line.length <= 60);
    const scored = lines.map(line => {
      const words = line.split(' ').filter(word => word.length > 1 && !stop.has(word.toLowerCase()));
      const cleaned = words.join(' ');
      let score = Math.min(cleaned.length, 35);
      if (/\d/.test(cleaned)) score += 18;
      if (/[A-Z]{2,}/.test(line)) score += 8;
      if (/^[A-Z0-9 -]+$/.test(line)) score += 5;
      if (/\b[A-Z]{1,5}[- ]?\d{2,}[A-Z0-9-]*\b/i.test(cleaned)) score += 22;
      return { cleaned, score };
    }).filter(item => item.cleaned);
    scored.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const item of scored) {
      if (chosen.join(' ').toLowerCase().includes(item.cleaned.toLowerCase())) continue;
      chosen.push(item.cleaned);
      if (chosen.join(' ').length > 75 || chosen.length >= 4) break;
    }
    return chosen.join(' ').slice(0, 110).trim();
  }

  async function visualGuess() {
    if (!state.photo) return showToast('Take a photo first');
    if (!navigator.onLine && !state.model) return showToast('Visual guess needs a connection the first time');
    setBusy('#visualButton', true);
    setAnalysisStatus('Loading on-device visual model…');
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js', 'tf');
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js', 'mobilenet');
      state.model ||= await window.mobilenet.load({ version: 2, alpha: .5 });
      setAnalysisStatus('Looking at the item…');
      const predictions = await state.model.classify($('#itemPreview'), 3);
      if (!predictions.length) throw new Error('No prediction');
      const labels = predictions.map(p => p.className.split(',')[0].trim()).filter(Boolean);
      labels.forEach(addSuggestion);
      if (!$('#itemQuery').value.trim()) updateQuery(labels[0]);
      setAnalysisStatus(`Visual hint: ${labels[0]}`);
      showToast('Visual hints added — confirm the exact model yourself');
    } catch (error) {
      console.error(error);
      setAnalysisStatus('Visual hint unavailable');
      showToast('Could not make a visual guess');
    } finally {
      setBusy('#visualButton', false);
    }
  }

  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  function setBusy(selector, busy) {
    const button = $(selector);
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  }

  function setAnalysisStatus(text) {
    $('#analysisStatus').textContent = text;
  }

  function addSuggestion(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean || state.suggestions.some(item => item.toLowerCase() === clean.toLowerCase())) return;
    state.suggestions.push(clean);
    state.suggestions = state.suggestions.slice(-8);
    const container = $('#suggestionChips');
    container.innerHTML = '';
    state.suggestions.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      button.textContent = `+ ${item}`;
      button.addEventListener('click', () => {
        const current = $('#itemQuery').value.trim();
        if (!current.toLowerCase().includes(item.toLowerCase())) updateQuery(`${current} ${item}`.trim());
      });
      container.append(button);
    });
  }

  function updateQuery(value) {
    state.query = String(value || '').replace(/\s+/g, ' ').trim();
    $('#itemQuery').value = state.query;
  }

  function selectCondition(condition) {
    state.condition = condition;
    $$('.condition-row button').forEach(button => button.classList.toggle('selected', button.dataset.condition === condition));
  }

  function ebaySoldUrl(query) {
    const clean = buildSearchQuery(query);
    return `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(clean)}&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1&_sop=13`;
  }

  function buildSearchQuery(query) {
    const clean = String(query || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    if (state.condition === 'Parts' && !/parts|repair|spares/i.test(clean)) return `${clean} parts repair`;
    return clean;
  }

  function openEbaySold(query) {
    const clean = String(query || '').trim();
    if (!clean) return showToast('Enter a brand, model or barcode first');
    if (!navigator.onLine) {
      queueSearch(clean);
      return showToast('Offline — search saved for when signal returns');
    }
    window.open(ebaySoldUrl(clean), '_blank', 'noopener,noreferrer');
  }

  function renderMarkets() {
    const container = $('#marketButtons');
    markets.forEach(market => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'market-button';
      button.innerHTML = `<strong>${escapeHTML(market.name)}</strong><small>${escapeHTML(market.detail)}</small>`;
      button.addEventListener('click', () => {
        const query = $('#itemQuery').value.trim();
        if (!query) return showToast('Enter the item details first');
        if (!navigator.onLine) return showToast('This comparison needs a connection');
        window.open(market.url(query), '_blank', 'noopener,noreferrer');
      });
      container.append(button);
    });
  }

  function addComp(event) {
    event.preventDefault();
    const value = Number($('#compPrice').value);
    if (!Number.isFinite(value) || value <= 0) return showToast('Enter a sold price above £0');
    state.comps.push(Math.round(value * 100) / 100);
    $('#compPrice').value = '';
    renderComps(true);
  }

  function renderComps(updateSale = false) {
    const list = $('#compList');
    list.innerHTML = '';
    state.comps.forEach((value, index) => {
      const pill = document.createElement('span');
      pill.className = 'comp-pill';
      pill.innerHTML = `${money.format(value)} <button type="button" aria-label="Remove ${money.format(value)}">×</button>`;
      pill.querySelector('button').addEventListener('click', () => {
        state.comps.splice(index, 1);
        renderComps(true);
      });
      list.append(pill);
    });
    const stats = getCompStats();
    $('#compCount').textContent = `${state.comps.length} comp${state.comps.length === 1 ? '' : 's'}`;
    const boxes = $$('#compStats > div');
    if (!stats) {
      $('#compStats').classList.add('empty');
      boxes.forEach(box => box.querySelector('strong').textContent = '—');
    } else {
      $('#compStats').classList.remove('empty');
      boxes[0].querySelector('strong').textContent = money.format(stats.low);
      boxes[1].querySelector('strong').textContent = money.format(stats.median);
      boxes[2].querySelector('strong').textContent = money.format(stats.high);
      if (updateSale) $('#salePrice').value = stats.median.toFixed(2);
    }
    calculate();
  }

  function getCompStats() {
    if (!state.comps.length) return null;
    const values = [...state.comps].sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    return { low: values[0], median: Math.round(median * 100) / 100, high: values.at(-1) };
  }

  function calculate() {
    const buy = numberValue('#buyPrice');
    const sale = numberValue('#salePrice');
    const postage = numberValue('#postagePrice');
    const fee = numberValue('#feePercent');
    const other = numberValue('#otherCosts');
    const target = numberValue('#targetProfit');
    const feeCost = sale * fee / 100;
    const profit = sale - buy - postage - feeCost - other;
    const roi = buy > 0 ? profit / buy * 100 : 0;
    const maxBuy = Math.max(0, sale - postage - feeCost - other - target);
    $('#profitResult').textContent = money.format(profit);
    $('#profitResult').style.color = profit < 0 ? 'var(--red)' : 'var(--green)';
    $('#roiResult').textContent = `${Math.round(roi)}% ROI`;
    $('#maxBuyResult').textContent = money.format(maxBuy);

    const badge = $('#decisionBadge');
    badge.className = 'decision-badge neutral';
    let label = 'Add prices';
    let note = 'Add the seller’s price and a realistic resale value.';
    if (sale > 0) {
      const evidence = state.comps.length;
      if (profit >= target && roi >= 45) {
        badge.className = 'decision-badge buy';
        label = 'Strong buy';
        note = evidence >= 3 ? 'The margin clears your target with several sold comparisons.' : 'The margin looks strong, but add more sold comparisons before paying.';
      } else if (profit > 0 && (profit >= target * .6 || roi >= 25)) {
        badge.className = 'decision-badge maybe';
        label = 'Negotiate';
        note = `Aim for ${money.format(maxBuy)} or below to protect your target profit.`;
      } else {
        badge.className = 'decision-badge avoid';
        label = profit < 0 ? 'Loss risk' : 'Thin margin';
        note = profit < 0 ? 'The likely costs are higher than the expected sale proceeds.' : `You would need a lower buy price or stronger evidence of a higher sale price.`;
      }
      if (state.comps.length === 1) note += ' One comparison is weak evidence.';
      if (state.comps.length > 1 && getCompStats().high > getCompStats().low * 1.8) note += ' Prices vary widely, so check editions and condition closely.';
    }
    badge.textContent = label;
    $('#riskNote').textContent = note;
    return { buy, sale, postage, fee, other, target, profit, roi, maxBuy };
  }

  function numberValue(selector) {
    const value = Number($(selector).value);
    return Number.isFinite(value) ? value : 0;
  }

  function resetScan() {
    state.photo = '';
    state.thumb = '';
    state.query = '';
    state.comps = [];
    state.suggestions = [];
    $('#scanWorkspace').classList.add('hidden');
    $('#itemPreview').removeAttribute('src');
    $('#suggestionChips').innerHTML = '';
    $('#itemNotes').value = '';
    ['buyPrice', 'salePrice', 'postagePrice', 'otherCosts'].forEach(id => $(`#${id}`).value = '0');
    $('#feePercent').value = state.settings.defaultFee;
    $('#targetProfit').value = state.settings.defaultTarget;
    selectCondition('Good');
    renderComps();
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveFind() {
    const query = $('#itemQuery').value.trim();
    if (!query) return showToast('Add the item name or model first');
    const values = calculate();
    const stats = getCompStats();
    const find = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      query,
      condition: state.condition,
      photo: state.thumb,
      comps: [...state.comps],
      compLow: stats?.low || 0,
      compMedian: stats?.median || 0,
      compHigh: stats?.high || 0,
      ...values,
      notes: $('#itemNotes').value.trim(),
      createdAt: new Date().toISOString()
    };
    await dbPut(find);
    showToast('Find saved on this phone');
    await renderFinds();
  }

  async function shareCurrent() {
    const query = $('#itemQuery').value.trim();
    if (!query) return showToast('Add the item details first');
    const calc = calculate();
    const stats = getCompStats();
    const text = [
      `BootScout valuation: ${query}`,
      `Condition: ${state.condition}`,
      stats ? `Sold comps: ${money.format(stats.low)}–${money.format(stats.high)} (median ${money.format(stats.median)})` : 'Sold comps: not recorded',
      `Seller wants: ${money.format(calc.buy)}`,
      `Likely sale: ${money.format(calc.sale)}`,
      `Expected profit: ${money.format(calc.profit)} (${Math.round(calc.roi)}% ROI)`,
      $('#itemNotes').value.trim() ? `Notes: ${$('#itemNotes').value.trim()}` : ''
    ].filter(Boolean).join('\n');
    try {
      const shareData = { title: `BootScout: ${query}`, text };
      if (state.photo && navigator.canShare) {
        const blob = await (await fetch(state.photo)).blob();
        const file = new File([blob], 'bootscout-item.jpg', { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) shareData.files = [file];
      }
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(text);
      if (!navigator.share) showToast('Summary copied');
    } catch (error) {
      if (error.name !== 'AbortError') showToast('Could not share the summary');
    }
  }

  async function openDB() {
    state.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => {
      console.error(error);
      showToast('Saved finds are unavailable in private browsing');
      return null;
    });
  }

  function dbPut(value) {
    if (!state.db) return Promise.resolve();
    return transactionPromise('readwrite', store => store.put(value));
  }

  function dbDelete(id) {
    if (!state.db) return Promise.resolve();
    return transactionPromise('readwrite', store => store.delete(id));
  }

  function dbAll() {
    if (!state.db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      request.onerror = () => reject(request.error);
    });
  }

  function transactionPromise(mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(STORE, mode);
      action(transaction.objectStore(STORE));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function renderFinds() {
    const all = await dbAll();
    const search = ($('#findSearch')?.value || '').toLowerCase().trim();
    const filtered = all.filter(find => !search || `${find.query} ${find.notes || ''}`.toLowerCase().includes(search));
    renderFindList($('#allFinds'), filtered, false);
    renderFindList($('#recentFinds'), all.slice(0, 3), true);
  }

  function renderFindList(container, finds, compact) {
    if (!container) return;
    container.innerHTML = '';
    if (!finds.length) {
      container.innerHTML = `<div class="empty-state"><strong>${compact ? 'No finds saved yet' : 'Your saved finds will appear here'}</strong>${compact ? 'Photograph your first item and save the valuation.' : 'Photos and calculations stay on this device.'}</div>`;
      return;
    }
    finds.forEach(find => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'find-card';
      card.innerHTML = `${find.photo ? `<img src="${find.photo}" alt="">` : '<span class="find-placeholder">£</span>'}<div><h3>${escapeHTML(find.query)}</h3><p>${escapeHTML(find.condition)} · ${new Date(find.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p></div><div class="profit ${find.profit < 0 ? 'negative' : ''}"><strong>${money.format(find.profit || 0)}</strong><small>${Math.round(find.roi || 0)}% ROI</small></div>`;
      card.addEventListener('click', () => openFind(find));
      container.append(card);
    });
  }

  function openFind(find) {
    const dialog = $('#findDialog');
    $('#findDialogContent').innerHTML = `${find.photo ? `<img class="find-detail-photo" src="${find.photo}" alt="Saved item">` : ''}<span class="kicker">Saved valuation</span><h2 style="text-align:left;margin:7px 38px 13px 0">${escapeHTML(find.query)}</h2><div class="find-detail-grid"><div><small>Seller wants</small><strong>${money.format(find.buy || 0)}</strong></div><div><small>Likely sale</small><strong>${money.format(find.sale || 0)}</strong></div><div><small>Expected profit</small><strong>${money.format(find.profit || 0)}</strong></div><div><small>Median comp</small><strong>${find.compMedian ? money.format(find.compMedian) : '—'}</strong></div></div>${find.notes ? `<p style="color:var(--muted);font-size:12px;line-height:1.5;margin-top:13px">${escapeHTML(find.notes)}</p>` : ''}<div class="find-detail-actions"><button id="reopenSold" class="primary" type="button">Sold results</button><button id="deleteFind" class="danger" type="button">Delete</button></div>`;
    $('#reopenSold').addEventListener('click', () => openEbaySold(find.query));
    $('#deleteFind').addEventListener('click', async () => {
      await dbDelete(find.id);
      dialog.close();
      await renderFinds();
      showToast('Find deleted');
    });
    dialog.showModal();
  }

  async function exportFinds() {
    const finds = await dbAll();
    if (!finds.length) return showToast('No saved finds to export');
    const headers = ['Item', 'Condition', 'Buy price', 'Likely sale', 'Postage', 'Fee %', 'Other costs', 'Profit', 'ROI %', 'Median comp', 'Notes', 'Saved'];
    const rows = finds.map(find => [find.query, find.condition, find.buy, find.sale, find.postage, find.fee, find.other, find.profit, find.roi, find.compMedian, find.notes, find.createdAt]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bootscout-finds-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
  }

  function renderChecklist(category) {
    const container = $('#checklist');
    container.innerHTML = '';
    (checklists[category] || checklists.general).forEach((text, index) => {
      const label = document.createElement('label');
      label.className = 'check-row';
      label.innerHTML = `<input type="checkbox" aria-label="Check ${index + 1}"><span>${escapeHTML(text)}</span>`;
      container.append(label);
    });
  }

  function loadSettings() {
    try {
      return { defaultFee: 0, defaultTarget: 15, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch (_) {
      return { defaultFee: 0, defaultTarget: 15 };
    }
  }

  function applySettingsToUI() {
    $('#defaultFee').value = state.settings.defaultFee;
    $('#defaultTarget').value = state.settings.defaultTarget;
    $('#feePercent').value = state.settings.defaultFee;
    $('#targetProfit').value = state.settings.defaultTarget;
  }

  function saveSettingsFromUI() {
    state.settings.defaultFee = numberValue('#defaultFee');
    state.settings.defaultTarget = numberValue('#defaultTarget');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    $('#feePercent').value = state.settings.defaultFee;
    $('#targetProfit').value = state.settings.defaultTarget;
    calculate();
    showToast('Defaults saved');
  }

  function queueSearch(query) {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (!queue.includes(query)) queue.push(query);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-20)));
  }

  function announceQueue() {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (!queue.length) return;
    const latest = queue.at(-1);
    localStorage.removeItem(QUEUE_KEY);
    showToast(`${queue.length} offline search${queue.length === 1 ? '' : 'es'} ready — opening latest`);
    setTimeout(() => openEbaySold(latest), 900);
  }

  function setOnlineState() {
    const pill = $('#networkPill');
    const online = navigator.onLine;
    pill.classList.toggle('offline', !online);
    $('span', pill).textContent = online ? 'Online' : 'Offline';
  }

  async function showInstall() {
    if (state.deferredInstall) {
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null;
      return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (isStandalone) return showToast('BootScout is already installed');
    $('#installSteps').innerHTML = isIOS
      ? `<div class="install-step"><b>1</b><span>Open this page in <strong>Safari</strong>.</span></div><div class="install-step"><b>2</b><span>Tap the <strong>Share</strong> button at the bottom of Safari.</span></div><div class="install-step"><b>3</b><span>Scroll and choose <strong>Add to Home Screen</strong>, then tap Add.</span></div>`
      : `<div class="install-step"><b>1</b><span>Open the browser menu.</span></div><div class="install-step"><b>2</b><span>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span></div><div class="install-step"><b>3</b><span>Confirm Install. BootScout will launch without browser controls.</span></div>`;
    $('#installDialog').showModal();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }
})();
