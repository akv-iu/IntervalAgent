import { isStop } from "../patterns";

export function isGlobalStop(text: string): boolean {
  if (!isStop(text)) return false;
  if (/\bstop\b|\bunsubscribe\b|\bleave\s+me\s+alone\b|\b(?:do\s+not|don't)\s+contact\s+me\b/i.test(text)) return true;
  const noCall = /\b(?:do\s+not|don't)\s+call\s+me\b/i.test(text);
  const noEmail = /\b(?:do\s+not|don't)\s+email\s+me\b/i.test(text);
  // Keep an explicit alternative channel open; an explicit global STOP always wins above.
  if (noCall && !noEmail && /\bemail\s+me\s+instead\b/i.test(text)) return false;
  if (noEmail && !noCall && /\bcall\s+me\s+instead\b/i.test(text)) return false;
  return true;
}
