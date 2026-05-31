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
  "alpha",
  "mate",
  "lycan",
  "orc",
  "slime",
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
  "paranormal",
  "urban fantasy",
  "villain",
  "bonds that tie",
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
  "kerri maniscalco",
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
  "rachel gillig",
  "liv zander",
  "jaymin eve",
  "rachel schneider",
  "elizabeth helen",
  "elizabeth dear",
  "c.m. nascosta",
  "cm nascosta",
  "cate c. wells",
  "cate c wells",
  "roxie ray",
  "rebecca ross",
  "k.f. breene",
  "kf breene",
  "briar boleyn",
  "colette rhodes",
  "k.a. tucker",
  "ka tucker",
  "amanda milo",
  "lisette marshall",
  "jessie mihalik",
  "michelle diener",
  "ilona andrews",
  "juliette cross",
  "amelia hutchins",
  "demi winters",
  "alex aster",
  "annette marie",
  "kayla edwards",
  "elizabeth hunter",
  "alexandria warwick",
  "c.c. peñaranda",
  "cc penaranda",
  "melissa k. roehrich",
  "melissa k roehrich",
  "lydia hope",
  "sylvia mercedes",
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
  "nisha j. tuli",
  "nisha j tuli",
  "helen scheuerer",
  "patricia briggs",
  "j.r. ward",
  "jr ward",
  "karen marie moning",
  "jeaniene frost",
  "j. bree",
  "j bree",
  "gail carriger",
  "anne bishop",
  "t. kingfisher",
  "t kingfisher",
  "thea guanzon",
  "stacey marie brown",
  "suzanne wright",
  "clare sager",
  "harper l. woods",
  "harper l woods",
  "olivia wildenstein",
  "sara hashem",
  "tahereh mafi",
  "renée ahdieh",
  "renee ahdieh",
  "maria v. snyder",
  "maria v snyder",
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

export function isKnownRomantasyFocusAuthor(author?: string | null): boolean {
  const normalizedAuthor = normalize(author ?? "");
  return FOCUS_AUTHORS.some((name) => normalizedAuthor.includes(name));
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

  if (isKnownRomantasyFocusAuthor(author)) {
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
