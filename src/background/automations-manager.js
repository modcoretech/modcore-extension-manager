/**
 * @file automations-manager.js
 * modcore Extension Manager - Automation rules background logic.
 */

'use strict';

export const RULES_STORAGE_KEY    = 'rules';
export const PROFILES_STORAGE_KEY = 'em_profiles';

let urlRulesCache = [];

/**
 * Returns the current cached URL rules (for the tab watcher).
 * Protocols are stripped so the coarse `tab.url.includes(...)` check works
 * regardless of whether the tab is http or https.
 */
export function getUrlRulesCache() {
    return urlRulesCache.map(rule => {
        const urlCondition = rule.trigger?.type === 'compound'
            ? rule.trigger.conditions?.find(c => c.type === 'url')
            : (rule.trigger?.type === 'url' ? rule.trigger : null);

        if (!urlCondition) return rule;

        const normalizedUrl = (urlCondition.url || '').replace(/^https?:\/\//i, '');
        return {
            ...rule,
            trigger: {
                ...rule.trigger,
                url: normalizedUrl,
                matchType: urlCondition.matchType || 'contains'
            }
        };
    });
}

/* ------------------------------------------------------------------ */
/* Trigger evaluation                                                  */
/* ------------------------------------------------------------------ */

async function evaluateTrigger(trigger) {
    if (!trigger) return false;
    if (trigger.type === 'compound') {
        if (!trigger.conditions || trigger.conditions.length === 0) return false;
        const results = await Promise.all(trigger.conditions.map(c => evaluateSingleCondition(c)));
        return trigger.operator === 'and' ? results.every(Boolean) : results.some(Boolean);
    }
    return evaluateSingleCondition(trigger);
}

async function evaluateSingleCondition(condition) {
    switch (condition.type) {
        case 'time': {
            const now = new Date();
            const [h, m] = (condition.time || '00:00').split(':').map(Number);
            const days = condition.days || [];
            return days.includes(now.getDay()) &&
                   now.getHours() === h &&
                   now.getMinutes() === m;
        }
        case 'time_range': {
            const now = new Date();
            const [sh, sm] = (condition.startTime || '00:00').split(':').map(Number);
            const [eh, em] = (condition.endTime || '23:59').split(':').map(Number);
            const days = condition.days || [];
            if (!days.includes(now.getDay())) return false;
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;
            if (startMin <= endMin) {
                return nowMin >= startMin && nowMin <= endMin;
            }
            // Overnight range
            return nowMin >= startMin || nowMin <= endMin;
        }
        case 'url': {
            try {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                const activeTab = tabs[0];
                if (!activeTab?.url) return false;
                return matchUrl(activeTab.url, condition.url, condition.matchType);
            } catch {
                return false;
            }
        }
        default:
            return false;
    }
}

/**
 * Compares a tab URL against a stored pattern. Protocols are stripped from
 * both sides so `https://example.com` matches both http and https tabs.
 */
function matchUrl(tabUrl, pattern, matchType = 'contains') {
    if (!tabUrl || !pattern) return false;
    const url = String(tabUrl).toLowerCase().replace(/^https?:\/\//i, '');
    const pat = String(pattern).toLowerCase().replace(/^https?:\/\//i, '');
    if (!pat) return false;

    switch (matchType) {
        case 'exact': return url === pat;
        case 'startsWith': return url.startsWith(pat);
        case 'contains':
        default: return url.includes(pat);
    }
}

/* ------------------------------------------------------------------ */
/* Alarm scheduling                                                    */
/* ------------------------------------------------------------------ */

function scheduleNextTimeRule(rule) {
    if (!rule?.enabled) return;
    const trigger = rule.trigger;
    let timeConditions = [];

    if (trigger?.type === 'compound') {
        timeConditions = (trigger.conditions || []).filter(c => c.type === 'time' || c.type === 'time_range');
    } else if (trigger?.type === 'time' || trigger?.type === 'time_range') {
        timeConditions = [trigger];
    }

    if (timeConditions.length === 0) return;
    const condition = timeConditions[0];
    const isRange = condition.type === 'time_range';
    const [hour, minute] = isRange
        ? (condition.startTime || '00:00').split(':').map(Number)
        : (condition.time || '00:00').split(':').map(Number);

    const now = new Date();
    let next = new Date(now);
    next.setHours(hour, minute, 0, 0);

    const days = condition.days || [];
    if (days.length === 0) return;

    if (next <= now) {
        next.setDate(next.getDate() + 1);
    }

    let found = false;
    for (let i = 0; i < 7; i++) {
        if (days.includes(next.getDay())) { found = true; break; }
        next.setDate(next.getDate() + 1);
    }

    if (found) {
        chrome.alarms.create(`rule_${rule.id}`, { when: next.getTime() });
    }
}

/**
 * Rebuilds URL-rule cache and recreates time-based alarms.
 */
export async function updateAlarmsAndCache() {
    try {
        const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const rules = stored[RULES_STORAGE_KEY] ?? [];

        // Cache rules with URL conditions (simple or compound)
        urlRulesCache = rules.filter(r => {
            if (!r?.enabled) return false;
            if (r.trigger?.type === 'url') return true;
            if (r.trigger?.type === 'compound') {
                return r.trigger.conditions?.some(c => c.type === 'url');
            }
            return false;
        });

        // Clear old rule alarms
        const allAlarms = await chrome.alarms.getAll();
        await Promise.all(
            allAlarms.filter(a => a.name.startsWith('rule_')).map(a => chrome.alarms.clear(a.name))
        );

        // Schedule time-based rules (simple or compound)
        const timeRules = rules.filter(r => {
            if (!r?.enabled) return false;
            if (r.trigger?.type === 'time' || r.trigger?.type === 'time_range') return true;
            if (r.trigger?.type === 'compound') {
                return r.trigger.conditions?.some(c => c.type === 'time' || c.type === 'time_range');
            }
            return false;
        });

        for (const rule of timeRules) {
            scheduleNextTimeRule(rule);
        }

        console.log(`[modcore Automations] Alarms updated. ${urlRulesCache.length} URL rule(s), ${timeRules.length} time rule(s).`);
    } catch (err) {
        console.error('[modcore Automations] Error in updateAlarmsAndCache:', err);
    }
}

/* ------------------------------------------------------------------ */
/* Action execution                                                    */
/* ------------------------------------------------------------------ */

async function executeSingleAction(action, selfId) {
    if (!action?.targetIds?.length) return;
    try {
        if (action.targetType === 'extension') {
            const enable = action.type === 'enable';
            const targets = enable ? action.targetIds : action.targetIds.filter(id => id !== selfId);
            if (targets.length > 0) {
                await Promise.allSettled(targets.map(id => chrome.management.setEnabled(id, enable)));
            }
        } else if (action.targetType === 'profile') {
            const profileId = action.targetIds?.[0];
            if (!profileId) return;
            const stored = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            const raw = stored[PROFILES_STORAGE_KEY];
            let profile = null;
            if (raw) {
                if (raw.profiles && typeof raw.profiles === 'object') profile = raw.profiles[profileId];
                if (!profile) profile = raw[profileId];
            }
            if (profile?.extensionStates && typeof profile.extensionStates === 'object') {
                await Promise.allSettled(
                    Object.entries(profile.extensionStates).map(([id, state]) => {
                        if (!state && id === selfId) return Promise.resolve();
                        return chrome.management.setEnabled(id, !!state);
                    })
                );
            }
        }
    } catch (err) {
        console.error('[modcore Automations] Action execution error:', err);
    }
}

/**
 * Executes a single rule action with full trigger re-evaluation for
 * compound conditions.
 */
export async function executeRuleAction(rule) {
    if (!rule) return;

    // For compound triggers, verify all conditions are truly met before acting.
    if (rule.trigger?.type === 'compound' || rule.trigger?.conditions) {
        const shouldRun = await evaluateTrigger(rule.trigger);
        if (!shouldRun) {
            console.log(`[modcore Automations] Rule "${rule.name}" skipped: compound conditions not met.`);
            return;
        }
    }

    console.log(`[modcore Automations] Executing rule: "${rule.name}"`);
    const selfId = chrome.runtime.id;

    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    for (const action of actions) {
        if (!action) continue;
        await executeSingleAction(action, selfId);
    }
}

/**
 * Handles a fired rule alarm and automatically computes the next schedule point.
 */
export async function handleRuleAlarm(alarmName) {
    if (!alarmName?.startsWith('rule_')) return;
    try {
        const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const rules = stored[RULES_STORAGE_KEY] ?? [];
        const rule = rules.find(r => r && `rule_${r.id}` === alarmName);

        if (rule?.enabled) {
            await executeRuleAction(rule);
            scheduleNextTimeRule(rule);
        }
    } catch (err) {
        console.error('[modcore Automations] Error in handleRuleAlarm:', err);
    }
}