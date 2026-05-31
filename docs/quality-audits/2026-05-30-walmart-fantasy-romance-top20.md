# Hotlist Quality Audit: Walmart Fantasy Romance Best Sellers

Date: 2026-05-30

## Scope

- Retail source: [Walmart Best Sellers in Fantasy Romance](https://www.walmart.com/c/best-sellers/fantasy-romance)
- Sample: first 20 products shown in Walmart's live `Best Seller` ordering.
- Live app: [myhotlist.app](https://www.myhotlist.app/)
- Method: search each title through the homepage search box, inspect the suggestions, and open the matching detail page when Hotlist surfaced the book.
- Database: reconcile live results against the production Supabase `books`, `book_ratings`, and `spice_signals` tables.

This is a retail-category stress test, not an industry-wide bestseller chart. Walmart's page mixes blockbuster books with long-tail fantasy romance titles.

## Results

| Rank | Walmart title used for lookup | Live Hotlist result | GR | AMZ | RIO | Spice |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | A Court of Thorns and Roses | Found | 4.2 | 4.6 | 4.0 | 3/5 |
| 2 | A Court of Mist and Fury | Found | 4.6 | 4.8 | 4.5 | 3/5 |
| 3 | A Court of Frost and Starlight | Found | 3.7 | 4.2 | 3.7 | 3/5 |
| 4 | Crown Me Dead | Missing | - | - | - | - |
| 5 | Crown Me Yours | Missing | - | - | - | - |
| 6 | House of Crimson Kisses | Missing | - | - | - | - |
| 7 | House of Crimson Curses | Missing | - | - | - | - |
| 8 | A Deal with the Elf King | Found | 3.7 | 4.3 | 3.5 | 3/5 |
| 9 | The Ever Queen | Found | 4.1 | 4.4 | 4.2 | 4/5 |
| 10 | Heart of the Wolf Queen | Missing | - | - | - | - |
| 11 | Red Dragon | Missing | - | - | - | - |
| 12 | Ash Trial at Warcrest | Not public: provisional DB row | - | - | - | - |
| 13 | Thorns & Fire | Found | 4.3 | 4.4 | 4.3 | 4/5 |
| 14 | Married to a Pirate | Missing | - | - | - | - |
| 15 | Love's a Witch | Not public: provisional DB row | - | - | - | - |
| 16 | Games of Flame and Dust | Missing | - | - | - | - |
| 17 | Shadows so Cruel | Missing | - | - | - | - |
| 18 | King of Flesh and Bone | Found as `King of Flesh and Bone: A Dark Fantasy Romance` | 3.6 | 4.1 | - | 3/5 |
| 19 | Wicked is the Reaper | Missing | - | - | - | - |
| 20 | Sin's Daughter | Missing | - | - | - | - |

## Coverage

- Publicly surfaced: 7/20 (35%)
- Present but stuck as non-canon provisional rows: 2/20 (10%)
- No credible matching database record found: 11/20 (55%)

## Database Findings

### P1: Current retail-category coverage is low

Only 7 of the 20 books were discoverable and openable in the production UI. Two additional exact-title records exist but remain non-canon and pending:

- `Ash Trial at Warcrest`
- `Love's a Witch`

### P1: Missing-title searches can return plausible but wrong books

The live UI offered unrelated suggestions for several absent titles. Examples:

- `House of Crimson Curses` suggested `Secrets & Curses of Crimson`.
- `Heart of the Wolf Queen` suggested `Tale of the Heart Queen`.
- `Married to a Pirate` suggested `Married Till Christmas`.
- `Sin's Daughter` suggested `The Origin's Daughter`.

These results are visible as suggestions, not selected replacements, but they create a discovery-quality risk.

### P2: Rating refresh cadence appears stale

For the seven surfaced books, the newest `book_ratings.scraped_at` values are 52-67 days old. Investigate whether scheduled rating refresh jobs are running and whether high-traffic books are being prioritized.

### P2: Source identifiers are incomplete

Among the seven surfaced books:

- Only `King of Flesh and Bone: A Dark Fantasy Romance` has an `amazon_asin`.
- None has a stored `romance_io_slug`.
- Six still display Romance.io ratings and Romance.io-derived spice, so the enrichment path is collecting values without persisting canonical Romance.io identity.

### P3: Enrichment status is inconsistent with user-visible completeness

Four of the seven surfaced books remain `partial` even though they render complete-looking detail pages:

- `A Court of Thorns and Roses`
- `A Court of Mist and Fury`
- `A Deal with the Elf King`
- `The Ever Queen`

Review the completion criteria and queue health so public pages do not silently remain in an unfinished enrichment state.

## Notes

- Amazon's Romantic Fantasy category page returned `503` during the audit, so Walmart's live fantasy-romance bestseller page was used as the fixed retail source.
- `King of Flesh and Bone` is a title-normalization case: Walmart omits the subtitle, while Hotlist stores and surfaces the longer title.
