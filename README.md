# High Risers · Houston Apartment Finder (self-hosted)

A password-protected search page for your Airtable **Properties** table. Prices, commission, specials and photos are read live from Airtable, so the site updates when the base changes (cached up to 15 minutes; the **Refresh from Airtable** button gets the latest right away).

## Files
- `server.js` – the web server. It handles the login and reads Airtable with your token (the token never reaches the browser).
- `public/index.html` – the search page.
- `package.json` – tells Railway how to install and start the app.
- `.env.example` – the settings Railway needs.

## 1. Create an Airtable token
1. Go to https://airtable.com/create/tokens → **Create token**.
2. Scope: `data.records:read` (read-only is enough).
3. Access: add only your Houston apartments base (`appbBEzby4dMTvMMl`).
4. Copy the token (it starts with `pat`). Treat it like a password.

## 2. Put the code on GitHub
Create a new **private** repository and upload these files (keep the `public` folder). Don't upload a `.env` file or `node_modules`.

## 3. Deploy on Railway
1. Railway → **New Project** → **Deploy from GitHub repo** → pick the repo.
2. Open the service → **Variables** and add:
   - `AIRTABLE_TOKEN` = your token
   - `SITE_USER` = the login name (for example `team`)
   - `SITE_PASSWORD` = a strong password
3. **Settings → Networking → Generate Domain** to get a URL. You can add your own domain there too.
4. Open the URL and log in with the user name and password.

Railway detects Node from `package.json` and runs `npm start`. It provides `PORT` automatically.

## Sharing with clients
1. Check **Select to share** on the properties you want. A bar at the bottom counts them; **Show only selected** lets you review your picks. Your picks are remembered in your browser.
2. Click **Share with client…**, add the client's name, email or phone and an optional note, then **Create link**.
3. Use **Copy**, **Email it** or **Text it** (opens Messages on your phone or Mac). Put the client's email in the **Client email** box first. With `RESEND_API_KEY` set, **Email it** sends the list straight to the client from High Risers, replies go to `AGENT_EMAIL`, and you get a copy at `NOTIFY_EMAIL`. Without it, **Email it** opens Gmail with the message written.
4. After you email or text it, the Finder clears your picks and goes back to the start for the next client.

What the client sees: a High Risers branded page with Joseph Dittman and the up-to-$500 rebate throughout, your note, and each property's photos, starting rents, specials and year built, plus a **Tour with Joseph** button on each property and Text/Call buttons. Once email is set up (see **Tour-request emails** below) the Tour button opens a short request form that emails you; until then it opens a text to Joseph.

What the client never sees: commission, escort %, bonus, occupancy, management, your notes, or the website links. Their page doesn't need the site password.

- Links last `SHARE_DAYS` days (30 by default). Prices and photos on the link are live, so they stay current.
- Links are signed, so nobody can edit one to show other properties. Changing `SHARE_SECRET` (or `SITE_PASSWORD`, if you didn't set a secret) turns off every link you've sent, so set a `SHARE_SECRET` once and leave it.
- If a property is removed from Airtable, it disappears from links that included it.

## Short links
With short links on, a client link looks like `apartmentlist-production.up.railway.app/tierra-johnson` instead of a long code.
- In the share window, type a **Link name** (letters, numbers, dashes), or leave it blank to use the client's name. If that name is taken, `-2`, `-3` and so on is added.
- Turn them on once: in Railway, right-click the service (or use the **+** button) → **Volume** → attach it to this service with mount path `/data`. Railway redeploys. The links are saved on that volume, so they survive redeploys.
- Without a volume, links still work but use the long form.
- Short links stop working after `SHARE_DAYS`, the same as long ones.

## Tour-request emails
When a client taps **Tour with Joseph** on their page, they fill in a short form (name prefilled, phone/email, when they can tour, a message). The request is emailed to `NOTIFY_EMAIL` (apartment@txhighrisers.com) with:
- the client name, phone and email you entered when you made the link, plus anything they typed
- the property, prices, special, **commission**, management and website
- when the link was sent, every property on their link, and the link itself
Hit **Reply** in your email to answer the client directly.

Setup (about 10 minutes):
1. Create a free account at https://resend.com.
2. **Domains → Add domain** → `txhighrisers.com`, and add the DNS records it shows where your domain is managed. Wait for "Verified".
3. **API Keys → Create** and copy it.
4. In Railway add `RESEND_API_KEY` (and `EMAIL_FROM` if you want a different sender on txhighrisers.com).

Until `RESEND_API_KEY` is set, the tour button just opens a text to Joseph instead of the form.

**Client name is required** to create a link, so every request ties back to a person. Client phone and email are optional but go into the email too.

## Amenity, building, parking and unit-style filters
The Finder filters on five Airtable fields in **Properties**. Fill them in and the filters pick them up on the next refresh:
- **Building Type**: Low-rise (1–3 stories), Mid-rise (4–9) or High-rise (10+). Until it's set, a property whose **Type** is High Rise counts as High-rise.
- **Unit Styles**: Flat, Townhome, Loft, Penthouse (pick all that apply).
- **Study/Den**: tick if any floor plan has a study or den.
- **Parking**: garage, covered, surface lot, valet and so on (pick all that apply).
- **Amenities**: pool, fitness center, pet friendly and so on. The filter shows properties that have *every* amenity you tap.
Each filter shows how many properties have it filled in. You can add new choices in Airtable and they appear as new chips. These details also show on the client's page.

## Notes
- If you rename fields in Airtable nothing breaks, because the code uses field IDs. If you delete a field, that information disappears from the cards.
- If Airtable is unreachable, the site keeps showing the last copy it loaded and says so at the top.
- Everyone you share the password with sees commission, so share it only with your team.
- Check: http://localhost:3000 after `npm install` and `AIRTABLE_TOKEN=... SITE_PASSWORD=... npm start` if you want to run it on your own computer first.
