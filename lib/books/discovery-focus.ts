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
  "basilisk",
  "shadow",
  "magic",
  "kingdom",
  "curse",
  "crown",
  "throne",
  "court",
  "blood",
  "bone",
  "bound",
  "immortal",
  "gods",
  "myth",
  "mythology",
  "zodiac academy",
  "academy romance",
  "why choose",
  "reverse harem",
  "monster romance",
  "alien romance",
  "sci-fi romance",
  "scifi romance",
  "danmei",
  "xianxia",
  "wuxia",
  "captiv prince",
  "captive prince",
  "heaven official's blessing",
  "grandmaster of demonic cultivation",
  "mo dao zu shi",
  "mó dào zǔ shī",
  "villains are destined to die",
  "mages of the wheel",
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
  "sable sorensen",
  "devney perry",
  "sarah a. parker",
  "sarah a parker",
  "caroline peckham",
  "susanne valenti",
  "lindsay straube",
  "keri lake",
  "stacia stark",
  "c.n. crawford",
  "cn crawford",
  "bree grenwich",
  "sheila masterson",
  "c.s. pacat",
  "cs pacat",
  "mò xiāng tóng xiù",
  "mo xiang tong xiu",
  "墨香铜臭",
  "j.d. evans",
  "jd evans",
  "suol",
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
