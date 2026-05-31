/**
 * Demand-focused discovery guard.
 *
 * Discovery jobs should favor romantasy and adjacent high-intent subgenres,
 * not the full romance long tail.
 */

const FOCUS_TERMS = [
  "romantasy",
  "fantasy romance",
  "romantic fantasy",
  "paranormal romance",
  "dark romance",
  "dark fantasy",
  "gothic romance",
  "vampire",
  "shifter",
  "witch",
  "fae",
  "faerie",
  "fairy",
  "dragon",
  "shadow",
  "magic",
  "kingdom",
  "curse",
  "crown",
  "throne",
  "court",
  "blood",
  "bone",
  "immortal",
  "gods",
  "myth",
  "mythology",
  "academy romance",
  "why choose",
  "reverse harem",
  "monster romance",
  "alien romance",
  "sci-fi romance",
  "scifi romance",
];

const FOCUS_AUTHORS = [
  "sarah j. maas",
  "sarah j maas",
  "rebecca yarros",
  "jennifer l. armentrout",
  "jennifer l armentrout",
  "carissa broadbent",
  "raven kennedy",
  "scarlett st. clair",
  "scarlett st clair",
  "laura thalassa",
  "holly black",
  "elise kova",
  "lj andrews",
  "l.j. andrews",
  "penn cole",
  "callie hart",
  "danielle l. jensen",
  "danielle l jensen",
  "lauren roberts",
  "kresley cole",
  "nalini singh",
  "ruby dixon",
  "katee robert",
  "h.d. carlton",
  "hd carlton",
  "rina kent",
  "ana huang",
];

const BROAD_ROMANCE_AUTHORS = [
  "danielle steel",
  "debbie macomber",
  "nora roberts",
  "nicholas sparks",
  "susan mallery",
  "robyn carr",
  "elin hilderbrand",
  "emily henry",
  "abby jimenez",
  "christina lauren",
  "jasmine guillory",
  "lynn painter",
];

const BROAD_ROMANCE_TERMS = [
  "contemporary romance",
  "sweet romance",
  "clean romance",
  "small town romance",
  "holiday romance",
  "cowboy romance",
  "christian romance",
  "amish romance",
  "billionaire romance",
  "sports romance",
  "beach read",
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
export function isRomantasyDiscoveryCandidate(input: {
  title: string;
  author?: string | null;
  context?: string | null;
}): boolean {
  const haystack = normalize(
    [input.title, input.author ?? "", input.context ?? ""].join(" ")
  );
  const author = normalize(input.author ?? "");

  if (FOCUS_AUTHORS.some((name) => author.includes(name))) {
    return true;
  }

  const hasFocusTerm = FOCUS_TERMS.some((term) => haystack.includes(term));
  if (hasFocusTerm) {
    return true;
  }

  const isBroadAuthor = BROAD_ROMANCE_AUTHORS.some((name) =>
    author.includes(name)
  );
  const isBroadContext = BROAD_ROMANCE_TERMS.some((term) =>
    haystack.includes(term)
  );

  if (isBroadAuthor || isBroadContext) {
    return false;
  }

  return false;
}
