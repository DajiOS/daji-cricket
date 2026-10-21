# Adding a storage disk for photos and videos

The server's own disk is small, and the photo and video library (4K drone videos run to 500 to 750 MB a minute) fills it fast.
These steps add a separate Lightsail storage disk and move the library onto it. Bookings, accounts and the rest stay where they
are. It takes about 20 minutes. The website is down for about a minute in step 4.

Cost: Lightsail storage disks are about US$0.10 per GB per month, so 100 GB is about $10 and 200 GB about $20 a month.

## 1. Create the disk (Lightsail console)

1. Sign in at https://lightsail.aws.amazon.com and open **Storage** (left menu), then **Create disk**.
2. Location: the same as the server, **Mumbai**, and the same zone. The server's page shows its zone, for example `ap-south-1a`.
3. Size: **200 GB** (or 100 GB to start; a disk can be made bigger later).
4. Name it `daji-media` and press **Create disk**.
5. Open the new disk, choose **Attach**, pick the website's server and press **Attach**.

## 2. Open a terminal on the server

On the server's page in Lightsail, press **Connect using SSH**. A black terminal window opens in the browser. Paste each block
below into it and press Enter. Copy each block whole.

## 3. Prepare the disk (once)

Find the new disk's name:

```sh
lsblk
```

Look for the line with the size you chose (for example `200G`) and nothing under MOUNTPOINT. Its name is usually `nvme1n1` or
`xvdf`. In the commands below, replace `nvme1n1` with that name if it differs. **Make sure it is the new, empty disk**: the next
command wipes the disk it is given.

```sh
DISK=/dev/nvme1n1
sudo mkfs -t ext4 $DISK
sudo mkdir -p /mnt/daji-media
sudo mount $DISK /mnt/daji-media
echo "UUID=$(sudo blkid -s UUID -o value $DISK) /mnt/daji-media ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
df -h /mnt/daji-media
```

The last line should show the disk's size, almost all free.

## 4. Move the library onto it

```sh
cd ~/cricket-booking/deploy
VOL=$(sudo docker volume ls -q | grep daji-data)
DATA=$(sudo docker volume inspect -f '{{ .Mountpoint }}' $VOL)
sudo docker compose stop api
sudo mkdir -p /mnt/daji-media/library
sudo rsync -a "$DATA/library/" /mnt/daji-media/library/
sudo chown -R 10001 /mnt/daji-media/library
cat > docker-compose.override.yml <<'EOF'
# The media library lives on the separate storage disk (deploy/STORAGE.md).
services:
  api:
    volumes: [ "/mnt/daji-media/library:/data/library" ]
EOF
sudo docker compose up -d
```

The website is back within a minute. The override file stays on the server; updates from GitHub do not remove it.

## 5. Check, then free the old space

1. In the desk, open **Website → Photos and videos**. **Space free** should now show the new disk (about 196 GB for 200 GB).
2. Open a few photos and a video on the website to make sure they play.
3. Once they do, delete the old copy on the small disk:

```sh
sudo rm -rf "$DATA/library"
df -h /
```

## 6. Turn on automatic snapshots of the disk

In Lightsail, open **Storage → daji-media → Snapshots** and switch on **Automatic snapshots**. Lightsail then keeps a copy of the
disk every day (snapshots are billed at about US$0.05 per GB per month for the space they use).

## If something goes wrong

To go back to the old place for the library, run `cd ~/cricket-booking/deploy && rm docker-compose.override.yml && sudo docker compose up -d`.
The old files are still on the small disk until step 5.3.
