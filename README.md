# Reader

A small phone app for tracking the books you're reading and how fast you read them, in words per minute (WPM).

It's a Progressive Web App (PWA): plain HTML, CSS and JavaScript with no build step. You add it to your phone's home screen, it opens full screen like a normal app, and it works offline.

## What it does

- **Books**: add a book with its title, author, total pages, current page and **words per page**. Books are sorted into Reading, Want to read and Finished.
- **Timed reading sessions**: tap **Start reading**. The timer keeps running if you lock your phone or close the app. Tap **Stop & log pages** and enter the page you reached.
- **Reading speed**: `WPM = (pages read × words per page) ÷ minutes`. Sessions under 1 minute are saved without a speed.
- **Log past session**: enter the minutes and pages for a session you didn't time.
- **Speed tab**: your average WPM (total words ÷ total minutes), the last 7 days, total time, pages, your fastest session, and a chart of your speed over time. You can show all books or just one.
- **Time left**: each book shows an estimate of how long it will take you to finish, based on your speed in that book.
- **Words-per-page estimator**: count the words on 3 lines and the number of lines on a page.
- **Backup**: in Settings you can export and import a JSON file. Your data is stored only in your phone's browser (localStorage).

## Run it on your computer

```bash
python3 -m http.server 8123
```

Then open http://localhost:8123.

## Put it on your phone (free, using GitHub Pages)

Service workers and installing to the home screen need HTTPS, so the app has to be hosted. GitHub Pages is the easiest free option.

1. Create a new **public** repository on GitHub, for example `reader`.
2. Upload these files: `index.html`, `app.js`, `styles.css`, `manifest.json`, `sw.js`, `icons/`.
3. In the repository, go to **Settings → Pages**. Set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then save.
4. After about a minute the app will be at `https://<your-username>.github.io/reader/`.
5. On your phone:
   - **iPhone**: open the link in **Safari**, tap **Share**, then **Add to Home Screen**.
   - **Android**: open the link in **Chrome**, tap **⋮**, then **Install app**.

Netlify Drop (drag the folder onto app.netlify.com/drop) or Cloudflare Pages work as well.

## Updating the app

Edit the files and upload them again. The service worker checks the network first, so the phone gets the new version the next time it opens the app while online. Your books and sessions are not affected.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: header, tab bar, bottom-sheet container |
| `app.js` | All app logic: data storage, views, timer, WPM math, chart, backup |
| `styles.css` | Styling, including light and dark mode |
| `manifest.json` | App name, icons and colors used when installed |
| `sw.js` | Service worker that lets the app work offline |
| `icons/` | Home-screen icons |
