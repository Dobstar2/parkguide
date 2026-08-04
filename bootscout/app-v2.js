(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const KEY_STORAGE = 'bootscout:gemini-key:v2';
  const SETTINGS_STORAGE = 'bootscout:settings:v2';
  const FINDS_STORAGE = 'bootscout:finds:v2';
  const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

  const state = {
    photo: '',
    photoThumb: '',
    mime: 'image/jpeg',
    recognition: null,
    comps: [],
    settings: loadJSON(SETTINGS_STORAGE, { autoScan: true, fee: 0 }),
    abortController: null
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindEvents();
    applySettings();
    renderFinds();
    setOnlineState();
    registerServiceWorker();

    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'finds') showView('finds');
    if (params.get('scan') === '1') setTimeout(() => $('#cameraInput').click(), 250);
  }

  function bindEvents() {
    $('#snapButton').addEventListener('click', () => $('#cameraInput').click());
    $('#retakeButton').addEventListener('click', () => $('#cameraInput').click());
    $('#newScanButton').addEventListener('click', resetScan);
    $('#cameraInput').addEventListener('change', handlePhoto);
    $('#settingsButton').addEventListener('click', openSetup);
    $('#setupForm').addEventListener('submit', saveSetup);
    $('#cancelSetupButton').addEventListener('click', () => $('#setupDialog').close());
    $('#toggleKeyButton').addEventListener('click', toggleKeyVisibility);
    $('#removeKeyButton').addEventListener('click', removeKey);
    $('#soldButton').addEventListener('click', () => openSold($('#searchQuery').value));
    $('#copyQueryButton').addEventListener('click', copyQuery);
    $('#manualForm').addEventListener('submit', event => {
      event.preventDefault();
      openSold($('#manualQuery').value);
    });
    $('#compForm').addEventListener('submit', addComp);
    ['buyPrice', 'salePrice', 'costsPrice', 'feePercent'].forEach(id => $(`#${id}`).addEventListener('input', calculate));
    $('#saveButton').addEventListener('click', saveFind);
    $('#closeFindDialog').addEventListener('click', () => $('#findDialog').close());
    $$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    addEventListener('online', () => { setOnlineState(); showToast('Back online'); });
    addEventListener('offline', setOnlineState);
  }

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      state.photo = await resizeImage(file, 1280, .82);
      state.photoThumb = await resizeImage(file, 420, .72);
      state.mime = state.photo.slice(5, state.photo.indexOf(';')) || 'image/jpeg';
      state.recognition = null;
      state.comps = [];
      $('#photoPreview').src = state.photo;
      $('#scanPanel').classList.remove('hidden');
      $('#resultCard').classList.add('hidden');
      $('#scanOverlay').classList.remove('hidden');
      $('#scanPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScanStatus('Photo captured', 'Checking visual recognition setup');

      if (!navigator.onLine) {
        setScanFailure('No connection', 'The photo is ready. Reconnect to run visual recognition.');
        return;
      }

      const key = getApiKey();
      if (!key) {
        setScanFailure('AI setup required', 'Add a free key once, then future photos identify automatically.');
        openSetup(true);
        return;
      }

      if (state.settings.autoScan) await recognisePhoto();
      else setScanFailure('Photo ready', 'Open settings and turn on automatic recognition, or save the key again.');
    } catch (error) {
      console.error(error);
      showToast('Could not prepare that photo');
    }
  }

  async function recognisePhoto() {
    const key = getApiKey();
    if (!key) return openSetup(true);
    if (!state.photo) return;

    state.abortController?.abort();
    state.abortController = new AbortController();
    $('#scanOverlay').classList.remove('hidden');
    $('#resultCard').classList.add('hidden');
    setScanStatus('Looking at the item…', 'Reading logos, labels, shape and model details');

    const base64 = state.photo.split(',')[1];
    const prompt = `You are a product identification specialist helping someone value an item at a UK car boot sale.
Inspect the image carefully. Read visible logos, labels, model numbers, text, colour, size cues, edition marks and included accessories.
Return the most specific truthful identification possible. Never invent a model number. If uncertain, leave the field empty and lower confidence.
The search_query must be concise eBay UK wording ordered as: brand, product/model, important variant, size/storage/edition, then condition only if visibly important. Do not include words like rare, vintage, valuable or car boot.
alternative_queries should contain up to 3 useful narrower or broader searches.
condition_notes should only describe visible evidence, not hidden functionality.
warnings should briefly state what the user must confirm before buying, especially model, size, authenticity, missing parts or untested condition.`;

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: state.mime, data: base64 } },
          { text: prompt }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 700,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            item_name: { type: 'STRING' },
            brand: { type: 'STRING' },
            model: { type: 'STRING' },
            variant: { type: 'STRING' },
            category: { type: 'STRING' },
            description: { type: 'STRING' },
            condition_notes: { type: 'STRING' },
            search_query: { type: 'STRING' },
            alternative_queries: { type: 'ARRAY', items: { type: 'STRING' } },
            identifiers: { type: 'ARRAY', items: { type: 'STRING' } },
            confidence: { type: 'INTEGER' },
            warnings: { type: 'STRING' }
          },
          required: ['item_name', 'brand', 'model', 'variant', 'category', 'description', 'condition_notes', 'search_query', 'alternative_queries', 'identifiers', 'confidence', 'warnings']
        }
      }
    };

    try {
      setScanStatus('Identifying the exact product…', 'This normally takes only a few seconds');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        body: JSON.stringify(body),
        signal: state.abortController.signal
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw apiError(response.status, data);
      const raw = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
      if (!raw) throw new Error('The recognition service returned no result.');
      const result = safeJSON(raw);
      validateRecognition(result);
      state.recognition = normaliseRecognition(result);
      renderRecognition();
      $('#scanOverlay').classList.add('hidden');
      $('#resultCard').classList.remove('hidden');
      $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast('Item identified — check the model before buying');
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(error);
      const message = humanError(error);
      setScanFailure('Recognition did not finish', message);
      showToast(message);
      if (/key|permission|quota/i.test(message)) openSetup(true);
    }
  }

  function apiError(status, data) {
    const message = data?.error?.message || `Recognition request failed (${status})`;
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function humanError(error) {
    const message = String(error?.message || error);
    if (!navigator.onLine) return 'No mobile signal. Try again when you reconnect.';
    if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(message)) return 'That Google AI key is not valid. Paste a fresh key in Settings.';
    if (/quota|rate limit|RESOURCE_EXHAUSTED|429/i.test(message)) return 'The free AI limit is temporarily reached. Try again shortly.';
    if (/Failed to fetch|network/i.test(message)) return 'The connection failed before recognition completed.';
    if (/blocked|safety/i.test(message)) return 'The image could not be processed. Try a clearer item-only photo.';
    return message.length < 120 ? message : 'Recognition failed. Try a clearer, closer photo.';
  }

  function safeJSON(raw) {
    try { return JSON.parse(raw); }
    catch (_) {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      return JSON.parse(cleaned);
    }
  }

  function validateRecognition(result) {
    if (!result || typeof result !== 'object') throw new Error('The visual result was not usable.');
    if (!String(result.search_query || result.item_name || '').trim()) throw new Error('The photo did not contain enough identifying detail.');
  }

  function normaliseRecognition(result) {
    const confidence = Math.max(1, Math.min(99, Number(result.confidence) || 45));
    const query = cleanText(result.search_query || [result.brand, result.model, result.variant, result.item_name].filter(Boolean).join(' '), 120);
    return {
      itemName: cleanText(result.item_name || query || 'Unidentified item', 100),
      brand: cleanText(result.brand, 50),
      model: cleanText(result.model, 60),
      variant: cleanText(result.variant, 70),
      category: cleanText(result.category, 50),
      description: cleanText(result.description, 220),
      condition: cleanText(result.condition_notes, 180),
      query,
      alternatives: [...new Set((Array.isArray(result.alternative_queries) ? result.alternative_queries : []).map(value => cleanText(value, 120)).filter(Boolean))].slice(0, 3),
      identifiers: [...new Set((Array.isArray(result.identifiers) ? result.identifiers : []).map(value => cleanText(value, 60)).filter(Boolean))].slice(0, 5),
      confidence,
      warnings: cleanText(result.warnings, 220)
    };
  }

  function cleanText(value, max = 120) {
    return String(value || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function renderRecognition() {
    const item = state.recognition;
    $('#itemName').textContent = item.itemName;
    $('#confidenceBadge').textContent = `${item.confidence}% confidence`;
    $('#searchQuery').value = item.query;
    $('#descriptionText').textContent = [item.description, item.condition].filter(Boolean).join(' · ');

    const cells = [
      ['Brand', item.brand || 'Not certain'],
      ['Model', item.model || 'Check label'],
      ['Variant', item.variant || 'Not clear'],
      ['Category', item.category || 'General']
    ];
    $('#identityGrid').innerHTML = cells.map(([label, value]) => `<div class="identity-cell"><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div>`).join('');

    const warnings = [item.warnings, item.identifiers.length ? `Visible identifiers: ${item.identifiers.join(', ')}` : ''].filter(Boolean).join(' ');
    $('#warningBox').textContent = warnings;
    $('#warningBox').classList.toggle('hidden', !warnings);

    const alternatives = [item.query, ...item.alternatives].filter(Boolean);
    $('#alternativeQueries').innerHTML = alternatives.map((query, index) => `<button class="query-chip" type="button" data-query="${escapeHTML(query)}">${index === 0 ? 'Best: ' : ''}${escapeHTML(query)}</button>`).join('');
    $$('.query-chip', $('#alternativeQueries')).forEach(button => button.addEventListener('click', () => {
      $('#searchQuery').value = button.dataset.query;
      openSold(button.dataset.query);
    }));

    state.comps = [];
    renderComps();
    $('#salePrice').value = 0;
    calculate();
  }

  function openSold(query) {
    const value = String(query || '').trim();
    if (!value) return showToast('Add a product name first');
    const url = new URL('https://www.ebay.co.uk/sch/i.html');
    url.searchParams.set('_nkw', value);
    url.searchParams.set('LH_Sold', '1');
    url.searchParams.set('LH_Complete', '1');
    url.searchParams.set('_sop', '13');
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  function addComp(event) {
    event.preventDefault();
    const value = Number($('#compPrice').value);
    if (!Number.isFinite(value) || value <= 0) return showToast('Enter a sold price');
    state.comps.push(Math.round(value * 100) / 100);
    $('#compPrice').value = '';
    renderComps();
  }

  function renderComps() {
    const sorted = [...state.comps].sort((a, b) => a - b);
    $('#compChips').innerHTML = sorted.map((value, index) => `<button class="comp-chip" type="button" data-index="${index}">${money.format(value)} <b>×</b></button>`).join('');
    $$('.comp-chip', $('#compChips')).forEach(button => button.addEventListener('click', () => {
      const value = sorted[Number(button.dataset.index)];
      state.comps.splice(state.comps.indexOf(value), 1);
      renderComps();
    }));
    const low = sorted[0];
    const high = sorted.at(-1);
    const median = getMedian(sorted);
    $('#lowPrice').textContent = low ? money.format(low) : '—';
    $('#medianPrice').textContent = median ? money.format(median) : '—';
    $('#highPrice').textContent = high ? money.format(high) : '—';
    if (median) $('#salePrice').value = median.toFixed(2);
    calculate();
  }

  function getMedian(sorted) {
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function calculate() {
    const buy = number('#buyPrice');
    const sale = number('#salePrice');
    const costs = number('#costsPrice');
    const fee = number('#feePercent');
    const feeValue = sale * (fee / 100);
    const profit = sale - buy - costs - feeValue;
    const roi = buy > 0 ? (profit / buy) * 100 : 0;
    const maxBuy = Math.max(0, sale - costs - feeValue - 15);
    $('#profitValue').textContent = money.format(profit);
    $('#roiValue').textContent = `${Math.round(roi)}% ROI`;
    $('#maxBuyValue').textContent = money.format(maxBuy);
    $('#profitValue').style.color = profit < 0 ? '#8e1717' : '';
  }

  function number(selector) {
    const value = Number($(selector).value);
    return Number.isFinite(value) ? value : 0;
  }

  function saveFind() {
    if (!state.recognition) return showToast('Identify an item first');
    const finds = getFinds();
    const sale = number('#salePrice');
    const buy = number('#buyPrice');
    const costs = number('#costsPrice');
    const fee = number('#feePercent');
    const profit = sale - buy - costs - sale * (fee / 100);
    finds.unshift({
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      createdAt: new Date().toISOString(),
      photo: state.photoThumb,
      recognition: state.recognition,
      query: $('#searchQuery').value.trim(),
      comps: [...state.comps],
      buy, sale, costs, fee, profit
    });
    localStorage.setItem(FINDS_STORAGE, JSON.stringify(finds.slice(0, 40)));
    renderFinds();
    showToast('Find saved on this phone');
  }

  function getFinds() {
    return loadJSON(FINDS_STORAGE, []);
  }

  function renderFinds() {
    const finds = getFinds();
    renderFindList($('#recentFinds'), finds.slice(0, 3));
    renderFindList($('#allFinds'), finds);
  }

  function renderFindList(container, finds) {
    if (!container) return;
    if (!finds.length) {
      container.innerHTML = '<div class="empty-state">No saved finds yet. Snap an item and save its valuation.</div>';
      return;
    }
    container.innerHTML = '';
    finds.forEach(find => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'find-card';
      button.innerHTML = `<img src="${find.photo || 'icon.svg'}" alt=""><span><strong>${escapeHTML(find.recognition?.itemName || find.query)}</strong><small>${escapeHTML(find.query)} · ${formatDate(find.createdAt)}</small></span><span class="find-profit">${money.format(find.profit || 0)}</span>`;
      button.addEventListener('click', () => openFind(find));
      container.append(button);
    });
  }

  function openFind(find) {
    const item = find.recognition || {};
    const median = getMedian([...(find.comps || [])].sort((a, b) => a - b));
    $('#findDetail').innerHTML = `<div class="find-detail">${find.photo ? `<img class="find-detail-photo" src="${find.photo}" alt="Saved item">` : ''}<span class="eyebrow">Saved visual match</span><h2>${escapeHTML(item.itemName || find.query)}</h2><div class="find-detail-grid"><div><small>Search</small><strong>${escapeHTML(find.query)}</strong></div><div><small>Confidence</small><strong>${Number(item.confidence || 0)}%</strong></div><div><small>Median comp</small><strong>${median ? money.format(median) : '—'}</strong></div><div><small>Expected profit</small><strong>${money.format(find.profit || 0)}</strong></div></div><div class="find-detail-actions"><button class="open" type="button">Open sold listings</button><button class="delete" type="button">Delete</button></div></div>`;
    $('.open', $('#findDetail')).addEventListener('click', () => openSold(find.query));
    $('.delete', $('#findDetail')).addEventListener('click', () => {
      const updated = getFinds().filter(entry => entry.id !== find.id);
      localStorage.setItem(FINDS_STORAGE, JSON.stringify(updated));
      $('#findDialog').close();
      renderFinds();
      showToast('Find deleted');
    });
    $('#findDialog').showModal();
  }

  function resetScan() {
    state.abortController?.abort();
    state.photo = '';
    state.photoThumb = '';
    state.recognition = null;
    state.comps = [];
    $('#scanPanel').classList.add('hidden');
    $('#resultCard').classList.add('hidden');
    scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('#cameraInput').click(), 260);
  }

  function setScanStatus(title, subtitle) {
    $('#scanStatus').textContent = title;
    $('#scanSubstatus').textContent = subtitle;
    $('.spinner', $('#scanOverlay')).classList.remove('hidden');
    $('.scanner-line', $('#scanOverlay')).classList.remove('hidden');
  }

  function setScanFailure(title, subtitle) {
    $('#scanStatus').textContent = title;
    $('#scanSubstatus').textContent = subtitle;
    $('.spinner', $('#scanOverlay')).classList.add('hidden');
    $('.scanner-line', $('#scanOverlay')).classList.add('hidden');
  }

  function openSetup(fromScan = false) {
    $('#apiKeyInput').value = getApiKey();
    $('#autoScanToggle').checked = state.settings.autoScan !== false;
    $('#removeKeyButton').classList.toggle('hidden', !getApiKey());
    $('#setupDialog').dataset.fromScan = fromScan ? '1' : '0';
    $('#setupDialog').showModal();
  }

  async function saveSetup(event) {
    event.preventDefault();
    const key = $('#apiKeyInput').value.trim();
    if (!key) return showToast('Paste your Google AI key');
    localStorage.setItem(KEY_STORAGE, key);
    state.settings.autoScan = $('#autoScanToggle').checked;
    localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(state.settings));
    $('#setupDialog').close();
    showToast('Visual recognition connected');
    if (state.photo) await recognisePhoto();
  }

  function removeKey() {
    localStorage.removeItem(KEY_STORAGE);
    $('#apiKeyInput').value = '';
    $('#removeKeyButton').classList.add('hidden');
    showToast('Saved key removed');
  }

  function toggleKeyVisibility() {
    const input = $('#apiKeyInput');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('#toggleKeyButton').textContent = input.type === 'password' ? 'Show' : 'Hide';
  }

  function applySettings() {
    $('#feePercent').value = Number(state.settings.fee || 0);
  }

  function getApiKey() {
    return localStorage.getItem(KEY_STORAGE) || '';
  }

  function copyQuery() {
    const value = $('#searchQuery').value.trim();
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => showToast('Search wording copied')).catch(() => {
      $('#searchQuery').select();
      document.execCommand('copy');
      showToast('Search wording copied');
    });
  }

  function showView(view) {
    $$('.view').forEach(section => section.classList.toggle('active', section.id === `${view}View`));
    $$('.bottom-nav [data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setOnlineState() {
    const online = navigator.onLine;
    $('#onlinePill').classList.toggle('offline', !online);
    $('#onlinePill span').textContent = online ? 'Online' : 'Offline';
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
          const width = Math.max(1, Math.round(image.naturalWidth * scale));
          const height = Math.max(1, Math.round(image.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function loadJSON(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed ?? fallback;
    } catch (_) { return fallback; }
  }

  function formatDate(value) {
    try { return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
  }
})();
