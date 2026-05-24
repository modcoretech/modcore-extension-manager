/**
 * @file crx-downloader.js
 * modcore Extension Manager - CRX/ZIP download helper.
 */

'use strict';

// ==========================================================================
// Constants
// ==========================================================================

const CRX_MAGIC = [0x43, 0x72, 0x32, 0x34]; // "Cr24"

// ==========================================================================
// Pending download tracking
// ==========================================================================

/**
 * Queue for in-flight CRX downloads handled by chrome.downloads.
 * Each entry is removed when onDeterminingFilename fires.
 * @type {Array<{url: string, name: string, id: string, type: 'crx'|'zip', timestamp: number}>}
 */
const _crxQueue = [];

// ==========================================================================
// URL & Filename Utilities
// ==========================================================================

function extractExtensionId(url) {
    const m = url.match(/\/detail\/[^/]+\/([a-p]{32})/i);
    return m ? m[1] : null;
}

function isWebStoreUrl(url) {
    return typeof url === 'string' && (
        url.includes('chrome.google.com/webstore/detail') ||
        url.includes('chromewebstore.google.com/detail')
    );
}

function sanitizeFilename(text) {
    if (!text || typeof text !== 'string') return 'unknown';
    let clean = text.replace(/[\x00-\x1f\x7f&/\\:"*<>|?]/g, '').trim();
    clean = clean.replace(/[.\s]+$/, '');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(clean)) {
        clean = '_' + clean;
    }
    if (clean.length > 200) clean = clean.slice(0, 200);
    return clean || 'unknown';
}

function getChromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    return m ? m[1] : '0.0.0.0';
}

function buildCRXUrl(arch, id, version) {
    return 'https://clients2.google.com/service/update2/crx'
        + '?response=redirect'
        + '&nacl_arch=' + encodeURIComponent(arch)
        + '&prodversion=' + encodeURIComponent(version)
        + '&acceptformat=crx2,crx3'
        + '&x=id%3D' + encodeURIComponent(id)
        + '%26installsource%3Dondemand%26uc';
}

// ==========================================================================
// Base64 helper (service-worker safe, no stack overflow)
// ==========================================================================

/**
 * Converts an ArrayBuffer to a base64 string without blowing the stack.
 * Processes in 8 KB chunks using spread syntax.
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    let binary = '';
    const chunkSize = 0x2000; // 8192

    for (let i = 0; i < len; i += chunkSize) {
        const end = Math.min(i + chunkSize, len);
        // Spread a small TypedArray slice directly into fromCharCode
        binary += String.fromCharCode(...bytes.subarray(i, end));
    }
    return btoa(binary);
}

// ==========================================================================
// CRX -> ZIP Conversion
// ==========================================================================

function stripCrxHeader(buffer) {
    if (buffer.byteLength < 8) {
        throw new Error('File too small to be a valid CRX');
    }

    const bytes = new Uint8Array(buffer);
    const view  = new DataView(buffer);

    for (let i = 0; i < 4; i++) {
        if (bytes[i] !== CRX_MAGIC[i]) {
            throw new Error('Invalid CRX magic number');
        }
    }

    const version = view.getUint32(4, true);
    let zipOffset;

    if (version === 2) {
        if (buffer.byteLength < 16) throw new Error('CRX2 file too small');
        const pubKeyLen = view.getUint32(8, true);
        const sigLen    = view.getUint32(12, true);
        zipOffset = 16 + pubKeyLen + sigLen;
    } else if (version === 3) {
        if (buffer.byteLength < 12) throw new Error('CRX3 file too small');
        const headerLen = view.getUint32(8, true);
        zipOffset = 12 + headerLen;
    } else {
        throw new Error(`Unsupported CRX version: ${version}`);
    }

    if (zipOffset < 0 || zipOffset >= buffer.byteLength) {
        throw new Error('CRX header extends beyond file length');
    }

    return buffer.slice(zipOffset);
}

// ==========================================================================
// Download Orchestration
// ==========================================================================

export function triggerCRXDownload(tab, type = 'crx') {
    if (!tab?.url) {
        console.warn('CRX: no tab URL provided.');
        return;
    }
    if (!isWebStoreUrl(tab.url)) {
        console.warn('CRX: not a Web Store extension page.', tab.url);
        return;
    }

    const extId = extractExtensionId(tab.url);
    if (!extId) {
        console.warn('CRX: could not extract extension ID from URL.', tab.url);
        return;
    }

    const extName       = sanitizeFilename(tab.title?.replace(/ - Chrome Web Store$/i, ''));
    const chromeVersion = getChromeVersion();

    if (type === 'zip') {
        downloadAsZip(extId, extName, chromeVersion);
    } else {
        downloadAsCrx(extId, extName, chromeVersion);
    }
}

function downloadAsCrx(extId, extName, chromeVersion) {
    chrome.runtime.getPlatformInfo(platform => {
        const arch = platform.nacl_arch || 'x86-64';
        const url  = buildCRXUrl(arch, extId, chromeVersion);

        _crxQueue.push({
            url,
            name: extName,
            id: extId,
            type: 'crx',
            timestamp: Date.now(),
        });
        pruneCrxQueue();

        chrome.downloads.download({ url, saveAs: true }, downloadId => {
            if (chrome.runtime.lastError) {
                console.error('CRX download failed:', chrome.runtime.lastError.message);
                const idx = _crxQueue.findIndex(q => q.url === url);
                if (idx !== -1) _crxQueue.splice(idx, 1);
            }
        });
    });
}

/**
 * Fetches the CRX, strips the header, and downloads as a ZIP file.
 * Uses a base64 data URL because service workers lack URL.createObjectURL.
 */
async function downloadAsZip(extId, extName, chromeVersion) {
    let url = null;

    try {
        const platform = await chrome.runtime.getPlatformInfo();
        const arch     = platform.nacl_arch || 'x86-64';
        url = buildCRXUrl(arch, extId, chromeVersion);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Update service returned HTTP ${response.status}`);
        }

        const buffer    = await response.arrayBuffer();
        const zipBuffer = stripCrxHeader(buffer);
        const base64    = arrayBufferToBase64(zipBuffer);
        const dataUrl   = `data:application/zip;base64,${base64}`;

        await chrome.downloads.download({
            url: dataUrl,
            filename: `${extName} [${extId.substring(0, 8)}].zip`,
            saveAs: true,
        });
    } catch (err) {
        console.error('ZIP download failed:', err);

        // Fallback: hand the raw CRX URL to chrome.downloads so the user
        // at least gets the file (they can rename .crx -> .zip manually).
        if (url) {
            _crxQueue.push({
                url,
                name: extName,
                id: extId,
                type: 'zip',
                timestamp: Date.now(),
            });
            pruneCrxQueue();
            chrome.downloads.download({ url, saveAs: true });
        }
    }
}

/** Removes queue entries older than 30 s to prevent leaks. */
function pruneCrxQueue() {
    const cutoff = Date.now() - 30000;
    while (_crxQueue.length > 0 && _crxQueue[0].timestamp < cutoff) {
        _crxQueue.shift();
    }
}

// ==========================================================================
// Download Event Listeners
// ==========================================================================

export function registerCrxListeners() {
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
        if (!item.url.startsWith('https://clients2.google.com/service/update2/crx')) return;

        const idx = _crxQueue.findIndex(q => q.url === item.url);
        if (idx === -1) return;

        const { name, id, type } = _crxQueue[idx];
        _crxQueue.splice(idx, 1);

        const vMatch  = item.filename.match(/_(\d+(?:_\d+)*)\.crx$/i);
        const version = vMatch ? vMatch[1].replace(/_/g, '.') : 'latest';

        const ext      = type === 'zip' ? 'zip' : 'crx';
        const filename = `${sanitizeFilename(name)} [${id.substring(0, 8)}].v${version}.${ext}`;

        suggest({ filename });
    });

    chrome.commands.onCommand.addListener(command => {
        if (command === 'download-crx') {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (tabs[0]) triggerCRXDownload(tabs[0], 'crx');
            });
        }
    });
}