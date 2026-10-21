# Serving photos and videos through a CDN

A CDN keeps copies of the website's photos, videos and background films in data centres across India (and the world) and hands
them to visitors from the nearest one. Videos start faster and buffer less, and the server does far less work. Booking pages,
accounts and the desk still come straight from the server. It takes about 20 minutes, with no downtime.

Cost: Lightsail's smallest distribution is about US$2.50 a month for 50 GB of traffic; the next is about $5 for 100 GB (the
first year may be free). Pick by how much video people watch; you can change plans later.

Before you start: the server update that adds CDN support must be live (it is, once this change is merged; the website then has a
section for the CDN at the bottom of `deploy/Caddyfile`).

## 1. Give the server a fixed address (skip if it already has one)

In Lightsail open **Networking**. If the server has a **static IP** already attached, go on to step 2. If not, press
**Create static IP**, pick the website's server, name it `daji-ip` and create it. It is free while attached.
If the server's address changes here, update the DNS records for dajicricket.com to the new address straight away.

## 2. Create the distribution

1. In Lightsail open **Networking**, then **Create distribution**.
2. **Origin**: choose the website's server (Mumbai). **Origin protocol policy**: **HTTP only**.
3. **Caching**: choose the preset **Best for static content** (it caches everything). The server already tells the CDN to keep
   photos and videos for a year and the background films for a week.
4. **Plan**: the 50 GB plan to start.
5. Name it `daji-media` and press **Create distribution**. It takes 5 to 15 minutes to be ready.
6. When its status says **Enabled**, copy its address from the top of its page. It looks like `d1abcd2efgh3.cloudfront.net`.

## 3. Check it works

Open this in a browser, with your distribution's address in place of the example:

```
https://d1abcd2efgh3.cloudfront.net/assets/loops/noir.webm
```

A short video of floodlight beams should play (or download). If you see **Not found**, wait five minutes and try again.

## 4. Tell the website to use it

Open the server terminal (**Connect using SSH** on the server's page) and run, with your address in place of the example:

```sh
cd ~/cricket-booking/deploy
echo "MEDIA_CDN=https://d1abcd2efgh3.cloudfront.net" | sudo tee -a .env
sudo docker compose up -d
```

The website is back within a few seconds. Hard-refresh it (Ctrl+Shift+R) and open a video in the gallery: it now comes from the
CDN. If the CDN ever has trouble, the website quietly falls back to loading from the server.

## To switch it off

Remove the `MEDIA_CDN=` line from `~/cricket-booking/deploy/.env` (`sudo nano .env`) and run `sudo docker compose up -d` again.
Then delete the distribution in Lightsail so it stops costing money.

## Optional: your own address (media.dajicricket.com)

Not needed; the cloudfront.net address works just as well. If you want it: on the distribution's **Custom domains** tab create a
certificate for `media.dajicricket.com`, add the CNAME record it shows in Wix (Domains, Manage DNS Records), wait for it to say
**Valid**, attach it, add a CNAME `media` pointing at the distribution's address, and then use
`MEDIA_CDN=https://media.dajicricket.com` in step 4.
