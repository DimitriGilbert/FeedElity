const defaultSiteUrl = "https://feedelity.dbuild.dev";
const siteName = "FeedElity";
const defaultTitle = "FeedElity - Self-Hosted Video RSS Client";
const defaultDescription =
  "Follow creators across YouTube, Odysee, and PeerTube in one fast, self-hosted interface. No tracking, no algorithms, just your content.";

function getSiteUrl() {
  const configuredUrl = import.meta.env.VITE_SITE_URL;
  return (configuredUrl ?? defaultSiteUrl).replace(/\/$/, "");
}

function getCanonicalUrl(pathname = "/") {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${getSiteUrl()}${normalizedPathname}`;
}

interface SeoOptions {
  title?: string;
  description?: string;
  pathname?: string;
  imagePath?: string;
  type?: "website" | "article";
}

function buildSeo({
  title = defaultTitle,
  description = defaultDescription,
  pathname = "/",
  imagePath = "/screenshot.webp",
  type = "website",
}: SeoOptions = {}) {
  const canonicalUrl = getCanonicalUrl(pathname);
  const imageUrl = getCanonicalUrl(imagePath);

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonicalUrl },
      { property: "og:type", content: type },
      { property: "og:image", content: imageUrl },
      { property: "og:image:type", content: "image/webp" },
      { property: "og:image:width", content: "1280" },
      { property: "og:image:height", content: "577" },
      { property: "og:image:alt", content: "FeedElity video RSS client interface" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: imageUrl },
      { name: "twitter:image:alt", content: "FeedElity video RSS client interface" },
    ],
    links: [{ rel: "canonical", href: canonicalUrl }],
  };
}

export {
  buildSeo,
  defaultDescription,
  defaultSiteUrl,
  defaultTitle,
  getCanonicalUrl,
  getSiteUrl,
  siteName,
};
