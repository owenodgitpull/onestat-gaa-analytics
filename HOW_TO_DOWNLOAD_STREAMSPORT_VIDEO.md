# How to Download Video from donegal.streamsport.ie

## Method 1: Browser Developer Tools (Recommended)

### Steps:
1. **Open the video page** in Chrome/Edge
2. **Right-click** → "Inspect" (or press F12)
3. Click the **"Network"** tab at the top
4. Click the **filter icon** and select "Media" (or type "m3u8" or "mp4" in the filter box)
5. **Refresh the page** (F5)
6. **Play the video**
7. Look for entries with:
   - `.m3u8` extension (HLS stream manifest)
   - `.mp4` or `.ts` files (actual video segments)
   - Look for the **largest file** or one with "master" or "playlist" in the name

8. **Right-click the .m3u8 or .mp4 file** → Copy → Copy URL

### If it's an .m3u8 file (HLS stream):
You'll need **ffmpeg** to download it (which is already in your backend Docker container):

```bash
# Open Command Prompt or PowerShell
cd "C:\Users\owen_\Downloads"

# Replace <URL> with the .m3u8 URL you copied
ffmpeg -i "<URL>" -c copy -bsf:a aac_adtstoasc "dungloe_match.mp4"
```

### If it's a direct .mp4 file:
Just paste the URL in your browser address bar and it will download!

---

## Method 2: yt-dlp (Best for Automated Downloads)

### Install yt-dlp:
```bash
# Windows (run in PowerShell as Admin):
winget install yt-dlp

# Or download from: https://github.com/yt-dlp/yt-dlp/releases
# Save yt-dlp.exe to C:\Windows\System32\
```

### Download the video:
```bash
cd "C:\Users\owen_\Downloads"
yt-dlp "https://donegal.streamsport.ie/[match-url]"
```

**Advantages:**
- Handles HLS streams automatically
- Downloads best quality
- Resumes interrupted downloads
- Works with most streaming sites

---

## Method 3: Browser Extension (Easiest for Non-Technical Users)

### Install "Video DownloadHelper" extension:
- **Chrome:** https://chrome.google.com/webstore (search "Video DownloadHelper")
- **Firefox:** https://addons.mozilla.org/en-US/firefox/addon/video-downloadhelper/

### Steps:
1. Install the extension
2. Navigate to the match video page
3. Play the video
4. Extension icon will light up when it detects video
5. Click the icon → Select the video → Download

**Note:** Some extensions require a companion app for certain video formats.

---

## Method 4: Screen Recording (Last Resort)

If the above methods don't work (e.g., heavy DRM protection):

### Windows 11/10 Built-in:
1. Press **Windows + G** (opens Game Bar)
2. Click the **Record button** (circle icon)
3. Play the video fullscreen
4. Stop recording when done
5. Video saves to: `C:\Users\owen_\Videos\Captures\`

### OBS Studio (Better Quality):
1. Download: https://obsproject.com/
2. Add "Display Capture" or "Window Capture" source
3. Select the browser window playing the video
4. Click "Start Recording"
5. Play video fullscreen
6. Stop when done

**Downsides:**
- Lower quality than direct download
- Larger file size
- Requires playing entire video in real-time

---

## Quick Test: Which Method Will Work?

Try this first to see what type of stream it is:

1. Open video page
2. Press **F12** → **Network** tab
3. Filter by "m3u8"
4. Play video
5. **If you see .m3u8 files** → Use Method 1 or 2 (ffmpeg/yt-dlp)
6. **If you see .mp4 files** → Direct download via URL
7. **If nothing appears** → Use Method 3 (extension) or 4 (screen record)

---

## Troubleshooting

### "Access Denied" or "Forbidden" Error:
The video might be checking referrer headers. Use yt-dlp with:
```bash
yt-dlp --referer "https://donegal.streamsport.ie/" "<video-url>"
```

### Video is Geo-blocked or Login-Required:
If you need to be logged in to view:
1. Login to the site in your browser
2. Use browser extension (Method 3) - it uses your existing session
3. Or use yt-dlp with cookies:
   ```bash
   # Export cookies from browser (use "Get cookies.txt" extension)
   yt-dlp --cookies cookies.txt "<video-url>"
   ```

### Video Downloads in Multiple Parts:
HLS streams are split into segments. Use ffmpeg or yt-dlp - they'll automatically stitch them together.

---

## Recommended Workflow for GAA Match Videos:

1. **Try yt-dlp first** (fastest, most reliable)
2. **If that fails** → Browser DevTools + ffmpeg
3. **If still failing** → Video DownloadHelper extension
4. **Last resort** → OBS Studio screen recording

---

## Legal Note:
Only download videos you have permission to access (e.g., your own club's matches). Don't redistribute or share downloaded content without permission.
