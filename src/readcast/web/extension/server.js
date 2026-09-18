const DEFAULT_SERVER = "http://127.0.0.1:43827";

async function getReadcastServer() {
  const { readcastServer } = await chrome.storage.local.get("readcastServer");
  // Move saved old defaults too, while preserving deliberate custom endpoints.
  if (!readcastServer || /^http:\/\/(127\.0\.0\.1|localhost):8765\/?$/.test(readcastServer)) {
    if (readcastServer) {
      await chrome.storage.local.set({ readcastServer: DEFAULT_SERVER });
    }
    return DEFAULT_SERVER;
  }
  return readcastServer;
}
