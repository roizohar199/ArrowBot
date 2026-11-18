export const MAX_SHORTCUT_DELAY_MS = 10000;
export const validShortcutDelay = value => Number.isInteger(value) && value >= 0 && value <= MAX_SHORTCUT_DELAY_MS;
