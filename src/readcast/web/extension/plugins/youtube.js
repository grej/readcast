/**
 * YouTube plugin — scrapes video metadata and comments.
 * Transcript fetching happens server-side via yt-dlp.
 */
const YoutubePlugin = {
  name: "youtube",
  matches: ["*://www.youtube.com/watch*"],

  options: [
    { id: "count", type: "slider", label: "Comments", min: 5, max: 100, default: 20 },
  ],

  matchesUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname.includes("youtube.com") && u.pathname === "/watch";
    } catch {
      return false;
    }
  },

  scrape(opts) {
    opts = opts || {};
    const limit = opts.count || 20;

    // -- Video metadata --
    const video = {};
    const params = new URLSearchParams(window.location.search);
    video.video_id = params.get("v") || "";
    video.url = window.location.href;
    video.needs_transcript = true;

    video.title =
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
      document.querySelector("h1.title")?.textContent?.trim() ||
      document.title;

    video.channel =
      document.querySelector("#channel-name yt-formatted-string a")?.textContent?.trim() ||
      document.querySelector("ytd-channel-name yt-formatted-string a")?.textContent?.trim() ||
      "";

    const descEl = document.querySelector("#description-inline-expander") ||
      document.querySelector("#description .content");
    video.description = descEl ? descEl.textContent.trim().slice(0, 2000) : "";

    const viewEl = document.querySelector("ytd-watch-info-text span") ||
      document.querySelector(".view-count");
    video.views = viewEl ? viewEl.textContent.trim() : "";

    const dateEl = document.querySelector("ytd-watch-info-text span:nth-child(3)") ||
      document.querySelector("#info-strings yt-formatted-string");
    video.published = dateEl ? dateEl.textContent.trim() : "";

    // -- Comments (if user has scrolled to them) --
    const comments = [];
    const commentEls = document.querySelectorAll("ytd-comment-thread-renderer");
    for (let i = 0; i < Math.min(commentEls.length, limit); i++) {
      const el = commentEls[i];
      const author = el.querySelector("#author-text span")?.textContent?.trim() || "";
      const text = el.querySelector("#content-text")?.textContent?.trim() || "";
      const likes = el.querySelector("#vote-count-middle")?.textContent?.trim() || "0";
      if (text) {
        comments.push({ author, text, likes });
      }
    }

    return { video, comments };
  },

  prompt(data) {
    const commentCount = data.comments ? data.comments.length : 0;
    return `You are a video analyst producing an audio briefing of a YouTube video.

Summarize this YouTube video based on the metadata${commentCount > 0 ? " and " + commentCount + " viewer comments" : ""}:

1. State the video title, channel, and view count
2. Summarize the video description
3. ${commentCount > 0 ? "Highlight key themes from viewer comments — what resonated, what was debated" : "Note that no comments were available"}
4. Conclude with a 1-sentence takeaway

Video data:
${JSON.stringify(data, null, 2)}`;
  },
};

if (typeof globalThis !== "undefined") {
  globalThis.__readcastPlugins = globalThis.__readcastPlugins || {};
  globalThis.__readcastPlugins.youtube = YoutubePlugin;
}
