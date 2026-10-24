# Daji Cricket Ground: phone app (Expo, iOS and Android)

One app for iPhone and Android, for everyone. What a person sees depends on who signs in (the same sign-in as the website: email or mobile number).

Sign-in extras:
- **Sign in with Microsoft**, shown once the server has `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` (`deploy/.env.example`). It signs in people who already have an account with the same email. A 2-step code is still asked for when the account has one.
- **Site switch**: the live server, or a test server (for example one running with `DEMO_MODE=1`). Always on the Daji Admin sign-in screen; in the customer app it opens with a long press on the logo. Store builds only reach `https` test servers.

- **Customer:** Book (ground, day inside the booking window, slots in a row, promo code, account credit, hold), Pay (Razorpay Checkout, a demo card on a demo server, or UPI with the reference), Mine (spend, history, cancel; for parents the Ground / Academy toggle and a switcher per child), Ask AI, Profile.
- **Staff:** Tasks (take photos with the camera to close a task), Bookings (today, upcoming, approvals, UPI payments to check; approve, record a payment, mark no-show, cancel), Books (the accounting overview) and More, each shown only if their permissions allow it.
- **Owner:** the same, plus under More: Promo codes (typed or generated, one-time), Team (add people from a role, adjust permissions, switch off) and Booking controls (opening and closing day, close or open days for everything / ground / practice / academy, the Razorpay switch). Owners also create and assign tasks.
- **Super admin:** the same as the owner, working inside the owner chosen under More.
- **Everyone:** a profile with a picture (or the initial), name, email, mobile, password and Sign out, and Face ID / fingerprint unlock (turned on under Profile; the app then asks for it when it opens and when you come back after two minutes away).

Task photos: the camera opens (never the gallery). The server accepts a photo only if it was taken within the last 5 minutes. Some phone cameras leave the shot time out of the saved file, so the app also sends the moment it took the picture, and the server uses that only when the file has no camera time of its own.

It talks to the same server as the website, so the booking rules, prices and permissions are the server's. When the website gains a feature, the app is updated alongside it.

## Run it
```
cd mobile
cp .env.example .env        # set EXPO_PUBLIC_API_URL
npm install
npx expo install --fix      # aligns every package to the Expo version you have
npx expo start              # scan the QR code with Expo Go
```
To test on a phone against your own computer, run the server with `DEMO_MODE=1` and put the computer's address (for example `http://192.168.1.20:4000`) in `.env`.

## Expo, builds and store review
See `docs/APP_REVIEW.md` for the Expo (EAS) setup, the preview-update workflow, what the stores need and the demo login for reviewers.

## Honest status
- **Not run on a device or simulator.** The build environment could not install Expo or React Native (the package registry was blocked), so this code was only syntax and logic checked with stand-in type stubs. Expect small fixes on the first run, and run `npx expo install --fix` because the pinned versions may be old.
- Real Razorpay payment loads Razorpay's checkout page inside a web view and passes the result to the server for signature verification. That is untested; try it with Razorpay test keys first.
- Store release needs your Apple Developer and Google Play accounts, screenshots and `eas build` (`eas.json` and the privacy and deletion pages are now in the repo). Apple can also reject apps that are only a web view; the booking, dashboard and Ask AI screens here are native for that reason, the team screens are native too.
- Push notifications are wired (Expo) but need your Expo project id and a physical device to test.
- The camera and profile-picture picker (`expo-image-picker`) need a real device or simulator with a camera; they could not be run here. The hosted preview replaces the camera with a file chooser.
- Customers can repeat a booking (daily, weekly, monthly, yearly) and set up auto-debit under Mine. Staff with the right permissions get Academy (attendance, students, monthly report cards) and Matches (ball-by-ball scoring) under More; the owner switches auto-debit on under Booking controls.
- Not in the app yet: entering expenses in the accounting module.
