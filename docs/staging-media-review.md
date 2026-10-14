# Staging content review — 15 October 2026

This reviewed patch affects only the frozen staging catalogue, never the local
database. No Neon catalogue writes have occurred. The original source has 77
films, 69 stored TMDB ratings and no stored trailers. Provider evidence is held
in ignored `backend/.staging-parity/content-review.json`; it contains public
metadata, not API credentials. The dry-run hashes that evidence into approval.

## Artwork and the original 39 availability findings

The original 24 Wikimedia HTTP 429 results were provider restrictions, not proof
of missing files. Fourteen other findings were transport/time-out failures, not
confirmed 404s. The remaining finding was the missing TMDB logo returning SPA
HTML. Checks now distinguish restricted, missing, invalid-content and transport
results, use bounded HEAD/GET requests, and never download movie artwork.

All 30 distinct Wikipedia files were individually queried using MediaWiki
imageinfo/extmetadata. Every record reported **Fair use**, copyrighted True,
with article-specific usage. None established permission for this external
website. Each affected movie's poster and backdrop is replaced in the approved
staging patch with artwork returned for its exact matched TMDB movie ID.
No Wikipedia permission entry is invented to bypass the importer.

| Reviewed file | Individual record | Reported basis | Staging decision |
| --- | --- | --- | --- |
+| File:Lagaan.jpg | [File record](https://en.wikipedia.org/wiki/File:Lagaan.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:The Dark Knight (2008 film).jpg | [File record](https://en.wikipedia.org/wiki/File:The_Dark_Knight_(2008_film).jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:3 idiots poster.jpg | [File record](https://en.wikipedia.org/wiki/File:3_idiots_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Inception (2010) theatrical poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Inception_(2010)_theatrical_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:QueenMoviePoster7thMarch.jpg | [File record](https://en.wikipedia.org/wiki/File:QueenMoviePoster7thMarch.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Interstellar film poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Interstellar_film_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:PK poster.jpg | [File record](https://en.wikipedia.org/wiki/File:PK_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Dangal Poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Dangal_Poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Baahubali 2 The Conclusion poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Baahubali_2_The_Conclusion_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:K.G.F Chapter 2.jpg | [File record](https://en.wikipedia.org/wiki/File:K.G.F_Chapter_2.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Pushpa - The Rise (2021 film).jpg | [File record](https://en.wikipedia.org/wiki/File:Pushpa_-_The_Rise_(2021_film).jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:RRR Poster.jpg | [File record](https://en.wikipedia.org/wiki/File:RRR_Poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Master 2021 poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Master_2021_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Top Gun Maverick Poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Top_Gun_Maverick_Poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Vikram 2022 poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Vikram_2022_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Avatar The Way of Water poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Avatar_The_Way_of_Water_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Oppenheimer (film).jpg | [File record](https://en.wikipedia.org/wiki/File:Oppenheimer_(film).jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Jawan film poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Jawan_film_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Jailer 2023 Tamil film poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Jailer_2023_Tamil_film_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Kantara poster.jpeg | [File record](https://en.wikipedia.org/wiki/File:Kantara_poster.jpeg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Pathaan film poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Pathaan_film_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Spider-Man- Across the Spider-Verse poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Spider-Man-_Across_the_Spider-Verse_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Dune Part Two poster.jpeg | [File record](https://en.wikipedia.org/wiki/File:Dune_Part_Two_poster.jpeg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Deadpool & Wolverine poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Deadpool_%26_Wolverine_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Salaar Part 1 – Ceasefire.jpg | [File record](https://en.wikipedia.org/wiki/File:Salaar_Part_1_%E2%80%93_Ceasefire.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:12th Fail poster.jpeg | [File record](https://en.wikipedia.org/wiki/File:12th_Fail_poster.jpeg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Inside Out 2 poster.jpg | [File record](https://en.wikipedia.org/wiki/File:Inside_Out_2_poster.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Devara Part 1.jpg | [File record](https://en.wikipedia.org/wiki/File:Devara_Part_1.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Kalki 2898 AD.jpg | [File record](https://en.wikipedia.org/wiki/File:Kalki_2898_AD.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |
| File:Stree 2.jpg | [File record](https://en.wikipedia.org/wiki/File:Stree_2.jpg) | Fair use; copyrighted True | Replace poster/backdrop with matched TMDB assets |

TMDB titles/original titles, original language and release year were checked
against all 77 persisted provider identities. Curated known title aliases are
explicit in the patch function. A mismatch cannot alter metadata. The staging
dry-run checks all movie, event, browse-card and bundled asset URLs; its detailed
result is in ignored `backend/.staging-parity/preview.json`.

TMDB artwork is used under its non-commercial API terms, with the unmodified
approved blue-short logo and required non-endorsement notice. This does not
grant commercial rights or claim ownership of underlying film artwork.
Existing Unsplash and repository-authored event assets are retained, not
represented as photographs of actual announced events. The prepared staging
notice labels fictional booking inventory and disabled payments before import.

References: [TMDB API use/attribution](https://developer.themoviedb.org/docs/faq),
[approved TMDB logos](https://www.themoviedb.org/about/logos-attribution),
[Wikipedia non-free content restrictions](https://en.wikipedia.org/wiki/Wikipedia:Non-free_content),
[Unsplash license](https://unsplash.com/license).

## Ratings audit: all 77 movies

All 69 existing score/vote/source/fetched-at tuples remain byte-for-byte
equivalent; current provider scores do not overwrite them. Eight missing scores
remain absent rather than fabricated:

| Movie | Provider finding | Decision |
| --- | --- | --- |
| Udta Teer | No votes; release 23 October | Keep absent |
| Delivery Boy | No votes; release 23 October | Keep absent |
| Prahaar | No votes; release 16 October | Keep absent |
| Clayface | One vote, 10/10; release 21 October | Hold unreleased score |
| 418 | No votes; release 23 October | Keep absent |
| The Eken: Kerala-e Kurukshetra | No votes; release 15 October | Keep absent |
| Ranabaali | No votes; release 16 October | Keep absent |
| Jailer 2 | No votes; provider date 14 October, local 15 October | Keep absent; preserve local date |

They can be revisited when released with genuine provider votes and refreshed
matching evidence. No release date is silently corrected by this patch.

## Trailers

62 legitimate trailer IDs are added only where TMDB supplies an official
YouTube Trailer and YouTube oEmbed confirms that exact video is available.
Original-language trailers are preferred. No videos are downloaded, no trailer
IDs are invented, and a working link does not guarantee regional availability.

15 films have no supported official trailer in the reviewed provider response:
Queen; Bajrangi Bhaijaan; Pradhama Drishtiya Kuttakkar; Delivery Boy; Premada
Oorali; Enthiran; Mandaadi; Prahaar; 3 Idiots; PK; Lagaan; The Eken: Kerala-e
Kurukshetra; Khalifa: The Ruler; Like Stars on Earth; Bethlehem Kudumba Unit.
Their trailer fields remain empty. An arbitrary fan upload is not substituted.

## Boundaries

The patch preserves every non-movie catalogue row, seat ID, layout, category,
price and show/session timestamp. Pure tests and a complete real-PostgreSQL
rollback test check this preservation and idempotence. No users, passwords,
bookings or financial records are copied. Live payments remain prohibited;
the catalogue import includes no tax policies and enables no genuine GST bill.
