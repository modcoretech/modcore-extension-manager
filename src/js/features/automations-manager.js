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
 * @returns {Array}
 */
export function getUrlRulesCache() {
    return urlRulesCache;
}

/**
 * Rebuilds URL-rule cache and recreates time-based alarms.
 */
export async function updateAlarmsAndCache() {
    try {
        const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const rules  = stored[RULES_STORAGE_KEY] ?? [];

        urlRulesCache = rules.filter(r => r.enabled && r.trigger?.type === 'url');

        // Clear only rule-prefixed alarms
        const allAlarms = await chrome.alarms.getAll();
        await Promise.all(
            allAlarms
                .filter(a => a.name.startsWith('rule_'))
                .map(a => chrome.alarms.clear(a.name))
        );

        const timeRules = rules.filter(r => r.enabled && r.trigger?.type === 'time');

        for (const rule of timeRules) {
            const [hour, minute] = (rule.trigger.time || '00:00').split(':').map(Number);
            const now = new Date();
            let next  = new Date(now);
            next.setHours(hour, minute, 0, 0);
            if (next <= now) next.setDate(next.getDate() + 1);

            // Advance to the nearest matching day-of-week
            let found = false;
            for (let i = 0; i < 7; i++) {
                if ((rule.trigger.days ?? []).includes(next.getDay())) { found = true; break; }
                next.setDate(next.getDate() + 1);
            }

            if (found) {
                chrome.alarms.create(`rule_${rule.id}`, {
                    when:            next.getTime(),
                    periodInMinutes: 7 * 24 * 60,
                });
            }
        }

        console.log(`Alarms updated. ${urlRulesCache.length} URL rule(s) cached.`);
    } catch (err) {
        console.error('updateAlarmsAndCache:', err);
    }
}

/**
 * Executes a single rule action.
 * @param {Object} rule
 */
export async function executeRuleAction(rule) {
    console.log(`Executing rule: "${rule.name}"`);
    try {
        if (rule.targetType === 'extension') {
            const enable = rule.action === 'enable';
            await Promise.allSettled(rule.targetIds.map(id => chrome.management.setEnabled(id, enable)));

        } else if (rule.targetType === 'profile') {
            const profileId = rule.targetIds?.[0];
            if (!profileId) return;
            const stored    = await chrome.storage.local.get(PROFILES_STORAGE_KEY);
            const profile   = stored[PROFILES_STORAGE_KEY]?.[profileId];
            if (profile?.extensionStates) {
                await Promise.allSettled(
                    Object.entries(profile.extensionStates)
                        .map(([id, state]) => chrome.management.setEnabled(id, state))
                );
            }
        }
    } catch (err) {
        console.error(`executeRuleAction "${rule.name}":`, err);
    }
}

/**
 * Handles a fired rule alarm.
 * @param {string} alarmName
 */
export async function handleRuleAlarm(alarmName) {
    if (!alarmName.startsWith('rule_')) return;
    try {
        const stored = await chrome.storage.local.get(RULES_STORAGE_KEY);
        const rule   = (stored[RULES_STORAGE_KEY] ?? []).find(r => `rule_${r.id}` === alarmName);
        if (rule?.enabled) {
            await executeRuleAction(rule);
        }
    } catch (err) {
        console.error('handleRuleAlarm:', err);
    }
}