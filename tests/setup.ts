// Tests never use the network.
globalThis.fetch = (() => {
  throw new Error("network disabled in tests");
}) as typeof fetch;
