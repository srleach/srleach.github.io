import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://seanrleach.co.uk/",
    title: "Sean Leach",
    description:
      "Fractional CTO and engineering lead. I help startups and scaleups move faster and get to revenue. Technical writing on the things I build.",
    author: "Sean Leach",
    profile: "https://seanrleach.co.uk/about/",
    lang: "en",
    timezone: "Europe/London",
    dir: "ltr",
  },
  posts: {
    perPage: 10,
    perIndex: 5,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: { enabled: false },
    search: "pagefind",
    toc: true,
  },
  socials: [{ name: "github", url: "https://github.com/srleach" }],
  shareLinks: [
    { name: "x", url: "https://x.com/intent/post?url=" },
    { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
  ],
});
