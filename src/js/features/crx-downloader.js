/**
 * @file crx-downloader.js
 * modcore Extension Manager - CRX download helper.
 */

'use strict';

let _pendingCrxName;
let _pendingCrxId;

function extractExtensionId(url) {
    const m = url.match(/\/detail\/[^/]+\/([a-p]{32})/i);
    return m ? m[1] : null;
}

function sanitizeFilename(text) {
    return text.replace(/[&/\\:"*<>|?]/g, '').trim();
}

function getChromeVersion() {
    const m = navigator.userAgent.match(/Chrome\/([\d.]+)/);
    return m ? m[1] : '0.0.0.0';
}

function buildCRXUrl(arch, id, version) {
    return `https://clients2.google.com/service/update2/crx?response=redirect&nacl_arch=${encodeURIComponent(arch)}&prodversion=${version}&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

export function triggerCRXDownload(tab) {
    if (!tab?.url) return;
    if (!tab.url.includes('chrome.google.com/webstore/detail') &&
        !tab.url.includes('chromewebstore.google.com/detail')) {
        console.warn('CRX: not a Web Store extension page.');
        return;
    }

    _pendingCrxId = extractExtensionId(tab.url);
    if (!_pendingCrxId) { console.warn('CRX: could not extract extension ID.'); return; }

    _pendingCrxName = sanitizeFilename(tab.title.replace(' - Chrome Web Store', ''));
    const version   = getChromeVersion();

    chrome.runtime.getPlatformInfo(platform => {
        const arch = platform.nacl_arch || 'x86-64';
        chrome.downloads.download({ url: buildCRXUrl(arch, _pendingCrxId, version), saveAs: true });
    });
}

export function registerCrxListeners() {
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
        if (!item.url.startsWith('https://clients2.google.com/service/update2/crx')) return;
        if (!_pendingCrxName || !_pendingCrxId) return;

        const vMatch  = item.filename.match(/_(\d+[_\d]*)/);
        const version = vMatch ? vMatch[1].replace(/_/g, '.') : 'latest';

        suggest({
            filename: `${sanitizeFilename(_pendingCrxName)} [${_pendingCrxId.substring(0, 8)}].v${version}.crx`,
        });

        _pendingCrxName = undefined;
        _pendingCrxId   = undefined;
    });

    chrome.commands.onCommand.addListener(command => {
        if (command === 'download-crx') {
            chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
                if (tabs[0]) triggerCRXDownload(tabs[0]);
            });
        }
    });
}