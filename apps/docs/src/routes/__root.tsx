import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { Nav } from "~/components/nav";
import { Footer } from "~/components/footer";

const siteUrl =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_SITE_URL
    ? import.meta.env.VITE_SITE_URL
    : "https://feedelity.dbuild.dev";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      { title: "FeedElity - Self-Hosted Video RSS Client" },
      {
        name: "description",
        content:
          "Personal-first, video-oriented RSS client. Follow creators across YouTube, Odysee, and PeerTube. Self-hosted, private, modern.",
      },
      { property: "og:title", content: "FeedElity - Self-Hosted Video RSS Client" },
      {
        property: "og:description",
        content:
          "Personal-first, video-oriented RSS client. Self-hosted, private, modern.",
      },
      { property: "og:url", content: siteUrl },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${siteUrl}/og-image.png` },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "FeedElity - Self-Hosted Video RSS Client",
      },
      {
        name: "twitter:description",
        content:
          "Personal-first, video-oriented RSS client. Self-hosted, private, modern.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Nav />
        <Outlet />
        <Footer />
        <Scripts />
      </body>
    </html>
  );
}
