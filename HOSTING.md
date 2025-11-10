# 🚀 Hosting Guide - Gunfight Arena

## How to Host Online for Your Friends

The game is now ready to host online! Here are a few options:

---

## **Option 1: Using Replit (Easiest - Free)**

1. Go to [replit.com](https://replit.com)
2. Sign up/Log in
3. Click "Import repository" and paste: `https://github.com/yourusername/1v1game` (or upload files manually)
4. Click the "Run" button
5. Copy the generated URL (looks like `https://project-name.username.replit.dev`)
6. Share that URL with your friends!

**Pros:** Free, easy, works with browser
**Cons:** May go to sleep if inactive, limited resources

---

## **Option 2: Using Heroku (Free tier ended, but cheap paid)**

1. Create account at [heroku.com](https://heroku.com)
2. Install Heroku CLI
3. In your project folder, run:
```bash
heroku login
heroku create your-game-name
git push heroku main
```
4. Your app will be live at `https://your-game-name.herokuapp.com`
5. Share the URL!

**Pros:** Professional hosting, more reliable
**Cons:** Paid service ($7-50/month depending on usage)

---

## **Option 3: Using Railway (Free trial - $5/month after)**

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. It auto-deploys! Your URL is shown in the project
6. Share the URL with friends

**Pros:** Easy, free trial, affordable
**Cons:** Free trial only ($5/month after)

---

## **Option 4: Using Glitch (Free)**

1. Go to [glitch.com](https://glitch.com)
2. Click "New Project" → "Clone from Git Repo"
3. Paste your repo URL
4. It auto-deploys!
5. Your URL is your project name: `https://project-name.glitch.me`

**Pros:** Free, fast, easy
**Cons:** Limited resources

---

## **Option 5: Local Network (For LAN Parties)**

If your friends are on the same WiFi network:

1. Run `npm start` on your computer
2. Find your local IP:
   - **Windows**: Open PowerShell, type `ipconfig`, find IPv4 Address
   - **Mac/Linux**: Open Terminal, type `ifconfig`
3. Share the IP with friends: `http://YOUR_IP_ADDRESS:3000`
4. Friends visit that URL in their browser

**Pros:** No setup needed, works offline
**Cons:** Only works on same network

---

## **Option 6: Using ngrok (Quick Testing)**

For quick testing without full deployment:

1. Download [ngrok](https://ngrok.com)
2. Run: `ngrok http 3000`
3. Copy the URL shown (looks like `https://xxxx-xx-xxx-xxx.ngrok.io`)
4. Share with friends!

**Pros:** Quick, no server setup
**Cons:** Temporary, resets on restart

---

## **Recommended for You:**

- **Quick Demo with Friends:** Use **Option 5** (Local Network) or **Option 6** (ngrok)
- **Permanent Hosting:** Use **Railway** or **Glitch** (free)
- **Professional Hosting:** Use **Heroku** or **Railway** (paid)
- **Easiest Setup:** Use **Replit**

---

## **After Deploying:**

Once hosted, the game will:
1. Show a lobby screen where players enter names and pick colors
2. Auto-start after 10 seconds
3. Up to 4 players can play at once
4. Each match lasts 2 minutes

---

## **Environment Variables (For Hosting)**

Make sure your host supports Node.js with:
- **PORT**: Usually auto-set (default 3000)
- **Node version**: 12 or higher

No additional environment variables needed!

---

**Questions? Check the README.md for more info!**
