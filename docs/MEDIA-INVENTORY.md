# Media inventory: photos, videos, music and logos

Checked on 20 October 2026 for the opening-day item "Remove or replace any photo, video, music or logo you do not own". It covers every image, video and sound file in the repository (`web/public`, `brand/reference`, `mobile/assets`) and the outside sources the pages load. **It cannot see the photos and videos uploaded through the desk** (Photos and videos, ground photos, the website gallery): those live on the server, so go through them in the desk too (see the last section).

This is a list for you and the advocate, not legal advice.

## Summary
| Risk | What | Action |
|---|---|---|
| High | `brand/reference/signage-photo.png` looks AI-generated (it carries the Gemini sparkle mark, bottom right) | Do not use it on the website, app or print. Replace it with a real photo of the sign once it is up. |
| High | The Daji logo and wordmark were traced from the sign maker's drawing (`brand/reference/signage-drawing.jpg`) | Get a written assignment of copyright in the logo design from the sign maker (or whoever drew it), and ask which fonts the lettering uses and whether their licence allows a logo. |
| Medium | The knot symbol | Ask the advocate for a trademark search before filing Class 41 / 39 (already item 9 in LEGAL-REVIEW.md). |
| Medium | MP13 name and branding | Written licence from Munaf Patel (already item 9 in LEGAL-REVIEW.md). |
| Low | `web/public/assets/intro.mp4` and `intro.webm` | Our own logo animation, no sound, and nothing on the site uses them now. Delete them, or keep them knowing they show the same logo as above. |
| None | Ball and sport symbols, theme logos, app icons | Drawn by the software from our own geometry or the logo; no outside artwork. |
| None | Fonts | Google Fonts (Cormorant Garamond, Inter, Barlow Semi Condensed), SIL Open Font Licence: free for commercial use. |
| None | Music | There is no music or sound file anywhere in the project. |
| None | Outside images | No page loads images from stock sites, Instagram or other websites. The Instagram link is a link only. |

## Every file
| File | Size | What it is | Who owns it | Used where |
|---|---|---|---|---|
| `brand/reference/signage-drawing.jpg` | 35 KB | The sign maker's drawing of the illuminated sign (orange artwork with measurements) | The person who drew it, unless they assigned it in writing | Source for tracing the logo (`brand/trace/`). Not on the website. |
| `brand/reference/signage-photo.png` | 2.1 MB | A picture of the lit sign on a wall. The sparkle mark in the corner is the Gemini image generator's watermark, so this is not a real photograph | Unclear: AI-generated images have uncertain copyright and the generator's terms apply | Reference only. Not on the website. |
| `web/public/assets/logo.svg`, `logo-brass.svg`, `logo-champagne.svg`, `logo-emerald.svg` | 154-156 KB each | The Daji logo and wordmark in four colourways, vector paths traced from the drawing above | Depends on the drawing (see High risk above) | Website header, desk, intro, emails |
| `web/public/assets/icon.svg` | 4 KB | The knot symbol alone | As above | Browser tab icon, desk |
| `web/public/assets/leather-ball.svg`, `leather-symbol.svg`, `ball-rw.svg` | 1-13 KB | Cricket ball drawings made by the software (`shared/src/ball.ts`); `leather-ball` carries the knot | Ours (the knot as above) | Website, intro |
| `web/public/assets/tennis-symbol.svg`, `nets-symbol.svg` | under 1 KB | Simple sport symbols drawn by the software | Ours | Website, booking |
| `web/public/assets/intro.mp4`, `intro.webm` | 666 KB, 526 KB | 8-second logo animation, no sound track | Ours (shows the logo) | Not used by any page now |
| `mobile/assets/icon.png`, `logo.png`, `splash.png` | | App icon, logo and splash screen, made from the logo | As the logo | Phone app |

## Before opening, in the desk (only you can do this)
1. Open **Photos and videos** in the desk and the website's gallery and ground photos (Settings, Website; Settings, Prices and timings for each ground).
2. For each photo or video, keep it only if you or your staff took it, or you have written permission from whoever did (a WhatsApp message saying "you may use my photo on the Daji website" is better than nothing; an email is better).
3. Remove clips taken from other people's Instagram or YouTube accounts unless they gave written permission, and anything with music in it (background music in a phone video is usually someone else's song).
4. Photos of identifiable customers or children (academy): get their or their parent's consent before putting them on the website.
5. Keep the permissions in a folder with this file.
