// Every attempt limit in one place (SPEC 8), so retries never multiply invisibly.
// The guard allows one regeneration with feedback, then the fallback template (see sim/loop.ts).
// Worst case per agent turn: (1 draft + 1 guard regeneration) x OUTPUT_ATTEMPTS x TRANSPORT_ATTEMPTS calls.
export const TRANSPORT_ATTEMPTS = 3; // network, 429 rate limit, 5xx; never quota, billing, auth, or bad requests
export const OUTPUT_ATTEMPTS = 2; // one corrective retry for invalid structured output
