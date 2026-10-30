# Legal and IP review checklist (Daji Cricket Ground)

The public pages (legal.html, privacy.html, the Terms window) are drafts written to Indian requirements. They are not legal advice and no software can be guaranteed free of patent claims. Have an Indian advocate review before 14 Nov 2026 opening.

## For the advocate
1. Entity: confirm the legal operator (proprietorship, partnership, LLP or company) and put its registered name, address and GST number in the footer and invoices.
2. Terms of use: liability limits, the risk and indemnity wording, Surat jurisdiction. Courts may not enforce a disclaimer for negligence causing injury.
3. Consumer law: Consumer Protection Act 2019 and E-Commerce Rules 2020 (grievance officer, 48h/1 month, refund display).
4. DPDP Act 2023 and Rules: notice and consent wording, breach process, children's data (academy), cross-border transfer.
5. Payments: Razorpay merchant terms, RBI rules, UPI. We keep no card data.
6. Sports and premises: public liability and personal accident insurance, local licence, fire and electrical safety (floodlights), municipal permission.
7. Staff: Shops and Establishments registration, wages and ESI where applicable (Provident Fund is not applicable to Daji). The software now works out PF, ESI, Gujarat PT and TDS (see accounting/statutory.ts); the CA should confirm the Gujarat PT slab (is exactly Rs 12,000 nil?), PF on basic versus gross, and TDS regime.
7a. Team terms (server/src/legal.ts): staff accept versioned wording; the hash, time and IP are kept. Advocate to review the wording.
7b. India tax rules (server/src/taxrules.ts, invoices.ts): cash limits and the GST invoice. Confirm the SAC (default 997212), the GST rate and when the business must register.
7c. Children's player profiles in the cricket network (server/src/network.ts, step 9 of the redesign addendum). Not reviewed yet and switched off: nothing about a child can be recorded until the software owner records this review (who, when, which document) in the switch. To review: DPDP Act 2023 s.9 and the Rules on verifiable consent of a parent or lawful guardian (today the guardian declares it and the declaration, the wording and the time are kept append-only; no identity check is made), the two consent wordings (`CONSENT_WORDING` v1: the match record, and sharing with network grounds), the age line (under 18 on the day), that a child's profile is never public and is shown to network grounds by first name and initial only, withdrawal taking effect at once (the child leaves tournament teams and squads of matches not yet started), and what a scorecard keeps after withdrawal (a match that has started keeps the name its ball-by-ball record uses, unlinked; for a network team that is the first name and initial). Adults added to a tournament team by mobile number or network profile are only asked, and are linked only when they agree in their own profile.
8. Messaging: WhatsApp (Meta template rules), TRAI DLT registration for SMS, consent records.
9. Trademark: file Daji Cricket Ground (Class 41 sports, Class 39 ground booking) and check MP13 licence from Munaf Patel in writing.
10. Patents: ask for a freedom-to-operate opinion only if you plan to claim novelty. Ordinary booking, payments and calendar features use standard, widely licensed methods.

## What we did to keep the software clean
- Original code and design; no copied code, images, fonts or text from other sites (Opal and others were references for feel only).
- Fonts: Google Fonts (SIL Open Font Licence). Libraries: open source (MIT, BSD, Apache 2.0). Run `npx license-checker --summary` in server, web, desk and mobile and keep the output with this file.
- No logos or trademarks of other companies are used as our own.
- Photos and video must come with written permission or be your own. The Instagram clips of others are not to be used without it.
- `docs/MEDIA-INVENTORY.md` lists every image, video and logo file in the project with who owns it and what to do. Two need action: the signage photo looks AI-generated (do not use it), and the logo was traced from the sign maker's drawing (get a written copyright assignment).
- Payment, WhatsApp and push providers are used through their official APIs under their own terms.
