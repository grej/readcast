/**
 * Gmail plugin — scrapes inbox and builds a prompt for LLM analysis.
 */
const GmailPlugin = {
  name: "gmail",
  matches: ["*://mail.google.com/*"],

  /** Check whether the current URL matches this plugin. */
  matchesUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname === "mail.google.com";
    } catch {
      return false;
    }
  },

  /** Scrape the top email rows from Gmail's inbox DOM. */
  scrape(maxCount) {
    const rows = document.querySelectorAll("tr.zA");
    const emails = [];

    const limit = Math.min(rows.length, maxCount || 20);
    for (let i = 0; i < limit; i++) {
      const row = rows[i];
      const email = {};

      // Unread status
      email.unread = row.classList.contains("zE");

      // Sender
      const senderEl = row.querySelector(".yW span[email]");
      if (senderEl) {
        email.sender = senderEl.getAttribute("name") || senderEl.textContent.trim();
        email.sender_email = senderEl.getAttribute("email") || "";
      } else {
        const fallback = row.querySelector(".yW span");
        email.sender = fallback ? fallback.textContent.trim() : "";
        email.sender_email = "";
      }

      // Subject
      const subjectEl = row.querySelector(".bog span") || row.querySelector(".bqe");
      email.subject = subjectEl ? subjectEl.textContent.trim() : "";

      // Preview / snippet
      const snippetEl = row.querySelector(".y2");
      if (snippetEl) {
        // Gmail prefixes snippets with " - ", strip that
        let text = snippetEl.textContent.trim();
        if (text.startsWith("-")) text = text.slice(1).trim();
        if (text.startsWith("\u2013")) text = text.slice(1).trim();
        email.preview = text;
      } else {
        email.preview = "";
      }

      // Date
      const dateEl = row.querySelector(".xW span");
      email.date = dateEl ? (dateEl.getAttribute("title") || dateEl.textContent.trim()) : "";

      emails.push(email);
    }
    return emails;
  },

  /** Build the prompt template for this plugin. */
  prompt(data) {
    return `You are an email assistant producing an audio briefing. Analyze these ${data.length} emails and categorize each as one of: spam, bulk/corporate, system notification (git/confluence/jira/automated), or important (needs human response).

Output a natural spoken briefing in this format:
1. One-line summary: "In the last 24 hours you received X emails..."
2. Counts by category
3. For important emails: 1-2 sentence summary of each, including sender and what action is needed
4. For bulk/system: one sentence summarizing the general topics
5. Skip spam entirely

Emails:
${JSON.stringify(data, null, 2)}`;
  },
};

// Export for content script access
if (typeof globalThis !== "undefined") {
  globalThis.__readcastPlugins = globalThis.__readcastPlugins || {};
  globalThis.__readcastPlugins.gmail = GmailPlugin;
}
