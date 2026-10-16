# Phone app: Expo setup and store review

The app is built with Expo (iOS and Android from one codebase). This repo is set up for EAS (Expo's build, update and submit service). Nothing below needs code changes: it needs your accounts.

**Honest status:** the app has never been run on a real phone or simulator from this environment. Expect small fixes on the first build. Run a preview build on your own phone first.

## 1. One-time setup (about 20 minutes)
1. Create a free account at expo.dev. Install the tools on your computer: `npm install -g eas-cli`, then `eas login`.
2. In the `mobile` folder run `eas init`. It creates the Expo project and writes its id into `app.json` (commit that change).
3. In expo.dev, Account settings, Access tokens: create a token. In GitHub (akeahms/daji-cricket) Settings, Secrets and variables, Actions: add it as `EXPO_TOKEN`. From then on every pull request touching `mobile/` gets a preview update link, and main publishes to the production channel (`.github/workflows/mobile.yml`).
4. Push notifications use the same project id, so `eas init` also switches them on. Upload your Apple push key and Android FCM key when `eas credentials` asks.

## 2. Try it yourself first
- Quick look (no build): install **Expo Go** on your phone, open the pull request link the workflow comments, or run `npx expo start` in `mobile` and scan the code.
- Real test build: `eas build --profile preview --platform android` gives an installable APK link. For iPhone: `eas build --profile preview --platform ios` (needs the Apple developer account below; the preview profile builds a simulator app unless you register your device with `eas device:create`).

## 3. Store accounts you need
- **Apple Developer Program** (about US$99 a year): developer.apple.com/programs. Gives you App Store Connect.
- **Google Play Console** (one-time about US$25): play.google.com/console. New personal accounts must run a closed test with 12 testers for 14 days before production; business accounts do not.

## 4. Build and submit
```
cd mobile
eas build --profile production --platform all
eas submit --profile production --platform all
```
Then complete the listing in App Store Connect / Play Console and press Submit for review.

## 5. What the reviewers need (already built into the app and website)
| Requirement | Status |
|---|---|
| Privacy policy URL | https://api.dajicricket.com/privacy.html (use the same address in both stores) |
| Account deletion inside the app (Apple 5.1.1(v)) | Profile, Delete my account (customers). Web page for Google: https://api.dajicricket.com/delete-account.html |
| Camera and photo permission texts | Set in `app.json` |
| Encryption export question | `ITSAppUsesNonExemptEncryption` is false (HTTPS only) |
| Not just a website in a frame | Booking, payments, dashboards and Ask AI are native screens |
| Demo login for the reviewer | **You must create it** (below) |

**Demo login.** The app signs in with email or mobile plus password, or a one-time code by WhatsApp. A reviewer cannot receive your WhatsApp code, so give them a password account:
1. Register a customer in the app or on the website: name `App Reviewer`, email `review@dajicricket.com` (or any address you control), a strong password.
2. Put the email and password in App Store Connect, App Review Information, Sign-in required. Do the same in Play Console, App access.
3. Keep the real owner and staff accounts out of the review notes. If you want the reviewer to see staff screens, create a separate staff member with only the permissions you want shown.
4. Keep Razorpay in **test mode** while the reviewer tries to pay, or tell them to use UPI and press the reference box, and give the test card `4111 1111 1111 1111` any future date and any CVV.

**Review notes to paste:** "Daji Cricket Ground is a cricket ground and academy in Surat, India. Customers book practice slots and pay with Razorpay or UPI. Sign in with the demo account above. Staff and owner features appear only for staff and owner accounts. Contact: Hemanshu Patel, 7567156000, dajicricket@gmail.com."

## 6. Store listing you will be asked for
- Name: Daji Cricket Ground. Subtitle: Book the ground. Category: Sports (or Lifestyle).
- Short description: Book cricket nets and the ground in Surat, pay by UPI or card, and follow the MP13 Academy.
- Screenshots: 6.7-inch iPhone and a phone-size Android set (Book, Pay, Mine, Ask AI). Take them from a preview build.
- Age rating: 4+ (no objectionable content). Data safety (Google) / Privacy nutrition label (Apple): collects name, email, phone, purchases, photos (optional), device id for push; not sold; deleted on request.
- Support URL: https://dajicricket.com, contact dajicricket@gmail.com.

## 7. After release
Small changes (text, screens that do not need new native code) go out without a store review: merge to main and the workflow publishes an update to the `production` channel. Anything that adds a native package or permission needs a new build and review (change `version` in `app.json` first).
