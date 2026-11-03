/** Actual authenticated browser acceptance; start the managed stack first. */
const script = new URL("../../scripts/test-launch-browser.mjs", import.meta.url).href;
await import(script);
