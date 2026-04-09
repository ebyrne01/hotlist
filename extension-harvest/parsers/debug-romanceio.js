/**
 * Debug parser — dumps romance.io page structure so we can fix the real parser.
 */
(() => {
  const info = {
    url: location.href,
    title: document.title,
  };

  // Find all links to /books/ pages
  const bookLinks = document.querySelectorAll("a[href*='/books/']");
  info.bookLinkCount = bookLinks.length;

  // Sample first 3 book link contexts
  info.samples = [];
  const seen = new Set();

  for (const link of bookLinks) {
    if (info.samples.length >= 3) break;
    const href = link.href;
    if (seen.has(href)) continue;
    seen.add(href);

    // Walk up to find the card container
    let card = link.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!card.parentElement) break;
      // Stop at something that looks like a card
      if (card.className && (
        card.className.includes('card') ||
        card.className.includes('book') ||
        card.className.includes('item') ||
        card.tagName === 'LI' ||
        card.tagName === 'ARTICLE'
      )) break;
      card = card.parentElement;
    }

    const sample = {
      linkHref: href,
      linkText: link.textContent.trim().slice(0, 100),
      linkTag: link.tagName,
      linkClasses: link.className,
      // Card info
      cardTag: card.tagName,
      cardClasses: card.className,
      cardChildCount: card.children.length,
      // All images in the card
      images: Array.from(card.querySelectorAll("img")).map(img => ({
        src: (img.src || img.getAttribute("data-src") || "").slice(0, 120),
        classes: img.className,
        alt: img.alt?.slice(0, 50),
        width: img.width,
      })),
      // All links in the card
      links: Array.from(card.querySelectorAll("a")).slice(0, 10).map(a => ({
        href: a.href?.slice(0, 100),
        text: a.textContent.trim().slice(0, 60),
        classes: a.className,
      })),
      // Text content snippets
      textSnippets: Array.from(card.querySelectorAll("span, p, div, h1, h2, h3, h4, h5")).slice(0, 15).map(el => ({
        tag: el.tagName,
        classes: el.className,
        text: el.textContent.trim().slice(0, 80),
      })),
      // Look for flame/spice/heat elements
      flameElements: Array.from(card.querySelectorAll("[class*='flame'], [class*='spice'], [class*='heat'], [class*='pepper'], [class*='fire']")).map(el => ({
        tag: el.tagName,
        classes: el.className,
        text: el.textContent.trim().slice(0, 30),
        html: el.innerHTML.slice(0, 200),
      })),
      // SVGs
      svgs: Array.from(card.querySelectorAll("svg")).map(s => ({
        classes: s.className?.baseVal || "",
        ariaLabel: s.getAttribute("aria-label"),
        width: s.getAttribute("width"),
      })),
      // Full inner HTML (first 2000 chars)
      outerHTML: card.outerHTML.slice(0, 2000),
    };

    info.samples.push(sample);
  }

  // Also check: what's the overall page structure?
  // Look for common list containers
  info.listContainers = [];
  for (const sel of ["[class*='book']", "[class*='card']", "[class*='grid']", "[class*='list']", "ul", "ol"]) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const bookLinksInside = el.querySelectorAll("a[href*='/books/']").length;
      if (bookLinksInside >= 3) {
        info.listContainers.push({
          selector: sel,
          tag: el.tagName,
          classes: el.className?.slice(0, 100),
          bookLinksInside,
          childCount: el.children.length,
        });
      }
    }
  }

  return info;
})();
