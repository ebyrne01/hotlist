import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hotlist — Find your next romance read",
    short_name: "Hotlist",
    description:
      "Compare romance and romantasy books side by side with ratings, spice levels, tropes, and AI synopses.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#d4430e",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
