/**
 * Reddit plugin — scrapes thread post and comments for indexing / LLM briefing.
 */
const RedditPlugin = {
  name: "reddit",
  matches: ["*://www.reddit.com/*", "*://old.reddit.com/*"],

  options: [
    { id: "comments", type: "select", label: "Comments",
      choices: ["Top N", "All", "None"], default: "Top N" },
    { id: "count", type: "slider", label: "", min: 5, max: 200, default: 20,
      showWhen: "Top N" },
    { id: "replies", type: "toggle", label: "Include replies", default: true },
  ],

  matchesUrl(url) {
    try {
      return new URL(url).hostname.includes("reddit.com");
    } catch {
      return false;
    }
  },

  scrape(opts) {
    opts = opts || {};
    const mode = opts.comments || "Top N";
    const limit = mode === "All" ? Infinity : (opts.count || 30);
    const maxDepth = opts.replies === false ? 0 : 1;

    // -- Post metadata --
    const post = {};
    post.subreddit = window.location.pathname.split("/")[2] || "";
    post.url = window.location.href;

    // New Reddit (shreddit- custom elements)
    const titleEl =
      document.querySelector("shreddit-title h1") ||
      document.querySelector('[slot="title"]') ||
      document.querySelector("h1");
    post.title = titleEl ? titleEl.textContent.trim() : document.title;

    const authorEl =
      document.querySelector("shreddit-post")?.getAttribute("author") ||
      document.querySelector('[data-testid="post_author_link"]')?.textContent?.trim();
    post.author = authorEl || "";

    const scoreEl =
      document.querySelector("shreddit-post")?.getAttribute("score") ||
      document.querySelector('[data-testid="post-score"]')?.textContent?.trim();
    post.score = scoreEl || "";

    // Post body
    const bodyEl =
      document.querySelector('[slot="text-body"]') ||
      document.querySelector('[data-testid="post-content"]') ||
      document.querySelector(".Post .RichTextJSON-root") ||
      document.querySelector(".usertext-body .md");
    post.body = bodyEl ? bodyEl.textContent.trim() : "";

    // -- Comments --
    if (mode === "None") return { post, comments: [] };

    const comments = [];

    // New Reddit: shreddit-comment elements
    const shredditComments = document.querySelectorAll("shreddit-comment");
    if (shredditComments.length > 0) {
      for (const el of shredditComments) {
        if (comments.length >= limit) break;
        const depth = parseInt(el.getAttribute("depth") || "0", 10);
        if (depth > maxDepth) continue;

        const author = el.getAttribute("author") || "";
        const score = el.getAttribute("score") || "";
        const contentEl = el.querySelector('[slot="comment"]') || el.querySelector(".md");
        const text = contentEl ? contentEl.textContent.trim() : "";
        if (text) {
          comments.push({ author, score, text, depth });
        }
      }
    } else {
      // Old Reddit: .comment elements
      const oldComments = document.querySelectorAll(".comment .entry");
      for (const el of oldComments) {
        if (comments.length >= limit) break;
        const author = el.querySelector(".author")?.textContent?.trim() || "";
        const score = el.querySelector(".score")?.title || el.querySelector(".score")?.textContent?.trim() || "";
        const contentEl = el.querySelector(".usertext-body .md");
        const text = contentEl ? contentEl.textContent.trim() : "";
        if (text) {
          comments.push({ author, score, text, depth: 0 });
        }
      }
    }

    return { post, comments };
  },

  prompt(data) {
    const commentCount = data.comments ? data.comments.length : 0;
    return `You are a discussion analyst producing an audio briefing of a Reddit thread.

Analyze this Reddit post and its ${commentCount} comments. Produce a natural spoken summary:

1. State the subreddit, post title, author, and score
2. Summarize the original post in 2-3 sentences
3. Identify the main perspectives and arguments in the comments
4. Note any consensus, strong disagreements, or particularly insightful comments
5. Conclude with a 1-sentence takeaway

Thread data:
${JSON.stringify(data, null, 2)}`;
  },
};

if (typeof globalThis !== "undefined") {
  globalThis.__readcastPlugins = globalThis.__readcastPlugins || {};
  globalThis.__readcastPlugins.reddit = RedditPlugin;
}
