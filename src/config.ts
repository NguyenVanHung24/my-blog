export const SITE = {
  website: "https://hungnv.dev/", // replace this with your deployed domain
  author: "Hung Nguyen",
  profile: "https://hungnv.dev/about",
  desc: "Cloud security engineer sharing notes on AWS, Kubernetes , and the journey of learning in public.",
  title: "Hung's Space",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 6,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: false,
    text: "Edit page",
    url: "https://github.com/hungnv/personal-blog/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "en",
  timezone: "Asia/Bangkok",
} as const;

// ─── UI Defaults ──────────────────────────────────────────────
// These are the default values on first visit (before user changes anything).
// Users can still toggle language and theme in the browser — their choice is saved.
export const UI = {
  // Default language: "en" | "vi"
  defaultLang: "en",

  // Default theme: "light" | "dark"
  defaultTheme: "light",
} as const;
