#!/usr/bin/env python3
"""
compile_community_promo.py — Planet CUHZ Community Compilation & Promo Engine
Aggregates community stream clips, renders branded attribution lower-thirds,
stitches them into a high-energy promo video using ffmpeg, and posts the final
video directly to Discord channel #cuhz-clips.
"""

import os
import sys
import json
import sqlite3
import datetime
import subprocess
from pathlib import Path

FFMPEG = "/Users/william/.local/bin/ffmpeg"
OUTPUT_DIR = Path("/Users/william/Desktop/Planet Cuhz/OBS Studio Stream Folder/output/promos")
DISCORD_ENV_PATH = Path("/Users/william/Desktop/Planet Cuhz/planetcuhz-redesign-worktree/Planet Cuhz/discord-ops/.env")
DB_PATH = Path("/Users/william/Desktop/Planet Cuhz/Cuhz_Bot/data/bot.db")
DISCORD_CLIPS_CHANNEL_ID = "1550527700827906059"
INTRO_PATH = Path("/Users/william/Desktop/Planet Cuhz/OBS Studio Stream Folder/output/playwright/cuhz-mascot-approval/intro-system-online-brand-type-x264-6000k-approved.mp4")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def get_discord_token():
    """Securely reads Discord bot token from .env without logging or leaking it."""
    if not DISCORD_ENV_PATH.exists():
        return None
    with open(DISCORD_ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("DISCORD_BOT_TOKEN="):
                return line.split("=", 1)[1].strip("\"'")
    return None


def fetch_pending_clips(limit=5):
    """Retrieves pending community clips from SQLite database."""
    if not DB_PATH.exists():
        return []
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT id, channel, clipped_by, title, clip_url, clip_id, timecode, created_at
            FROM community_clips
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?
        """, (limit,))
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return rows
    except Exception as e:
        print(f"[-] DB Query error: {e}")
        return []


def mark_clips_posted(clip_ids):
    """Updates clip status to 'posted' in database."""
    if not DB_PATH.exists() or not clip_ids:
        return
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        placeholders = ",".join("?" for _ in clip_ids)
        cur.execute(f"UPDATE community_clips SET status = 'posted' WHERE id IN ({placeholders})", clip_ids)
        conn.commit()
        conn.close()
        print(f"[*] Marked {len(clip_ids)} clips as posted in database.")
    except Exception as e:
        print(f"[-] DB Update error: {e}")


def generate_lower_third_overlay(clip_meta, width=1920, height=1080):
    """Generates an ffmpeg drawtext filter string for community attribution."""
    streamer = clip_meta.get("channel", "PlanetCUHZ").upper()
    clipper = clip_meta.get("clipped_by", "Community").upper()
    title = clip_meta.get("title", "Highlight Moment")
    # Clean text to prevent ffmpeg filter parsing issues
    safe_title = title.replace(":", "\\:").replace("'", "\\'").replace('"', '')

    # Render a semi-transparent dark banner box with neon green & cyan text
    # Display for the first 5 seconds of the clip
    filter_str = (
        f"drawbox=y=ih-140:color=black@0.75:width=iw:height=140:t=fill:enable='between(t,0,5)',"
        f"drawtext=text='PLANET CUHZ COMMUNITY SPOTLIGHT':fontcolor=#00FF66:fontsize=24:x=60:y=h-115:enable='between(t,0,5)',"
        f"drawtext=text='STREAM\\: @{streamer}  |  CLIPPED BY\\: @{clipper}':fontcolor=#00D4FF:fontsize=32:x=60:y=h-80:enable='between(t,0,5)',"
        f"drawtext=text='\"{safe_title}\"':fontcolor=white:fontsize=22:x=60:y=h-42:enable='between(t,0,5)'"
    )
    return filter_str


def build_compilation(clip_items, output_file):
    """
    Stitches clips into a unified 1080p 30fps promo with lower-thirds and intro.
    clip_items is a list of tuples: (file_path, clip_metadata_dict)
    """
    temp_segments = []
    
    # 1. Prepare Intro segment (short punchy 3.5s bumper)
    intro_segment = OUTPUT_DIR / "temp_intro.mp4"
    if INTRO_PATH.exists():
        cmd_intro = [
            FFMPEG, "-y",
            "-ss", "0", "-t", "3.5",
            "-i", str(INTRO_PATH),
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-shortest",
            str(intro_segment)
        ]
        subprocess.run(cmd_intro, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        temp_segments.append(intro_segment)

    # 2. Process each clip segment
    for idx, (fpath, meta) in enumerate(clip_items):
        seg_out = OUTPUT_DIR / f"temp_seg_{idx}.mp4"
        overlay = generate_lower_third_overlay(meta)
        vf_filter = (
            f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
            f"{overlay}"
        )
        cmd_seg = [
            FFMPEG, "-y",
            "-i", str(fpath),
            "-vf", vf_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            str(seg_out)
        ]
        subprocess.run(cmd_seg, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        temp_segments.append(seg_out)

    # 3. Prepare Outro Call-To-Action card (3 seconds)
    outro_segment = OUTPUT_DIR / "temp_outro.mp4"
    outro_filter = (
        "color=c=black:s=1920x1080:d=3.5,fps=30,"
        "drawtext=text='PLANET CUHZ COMMUNITY':fontcolor=#00FF66:fontsize=52:x=(w-text_w)/2:y=(h-text_h)/2-60,"
        "drawtext=text='CLIP YOUR FAVORITE MOMENTS WITH !clip IN CHAT':fontcolor=#00D4FF:fontsize=32:x=(w-text_w)/2:y=(h-text_h)/2,"
        "drawtext=text='JOIN THE DISCORD  *  PLANETCUHZ.COM':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+60"
    )
    cmd_outro = [
        FFMPEG, "-y",
        "-f", "lavfi", "-i", outro_filter,
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-shortest",
        str(outro_segment)
    ]
    subprocess.run(cmd_outro, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    temp_segments.append(outro_segment)

    # 4. Concatenate all segments
    concat_list_file = OUTPUT_DIR / "concat_list.txt"
    with open(concat_list_file, "w") as f:
        for seg in temp_segments:
            f.write(f"file '{seg.resolve()}'\n")

    cmd_concat = [
        FFMPEG, "-y",
        "-f", "concat", "-safe", "0",
        "-i", str(concat_list_file),
        "-c", "copy",
        str(output_file)
    ]
    subprocess.run(cmd_concat, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"[*] Compilation successfully generated: {output_file}")

    # Cleanup temporary segment files
    for seg in temp_segments:
        try:
            seg.unlink()
        except OSError:
            pass
    if concat_list_file.exists():
        concat_list_file.unlink()

    return output_file


def post_to_discord(video_path, featured_streamers, featured_clippers):
    """Securely uploads the finished promo video to Discord channel #cuhz-clips."""
    token = get_discord_token()
    if not token:
        print("[-] Discord token not found, skipping Discord upload.")
        return False

    streamer_tags = ", ".join(f"@{s}" for s in set(featured_streamers))
    clipper_tags = ", ".join(f"@{c}" for c in set(featured_clippers))

    payload = {
        "content": "🎬 **NEW COMMUNITY PROMO COMPILATION DROPPED!** 🔥",
        "embeds": [
            {
                "title": "🌌 Planet CUHZ • Community Clip Reel",
                "description": (
                    "Here is the latest free promo showcase featuring epic plays, reactions, "
                    "and clutch moments from our community streams!\n\n"
                    f"**Featured Streamers:** {streamer_tags}\n"
                    f"**Clipped By:** {clipper_tags}\n\n"
                    "💡 *Want to get featured in the next promo? Type `!clip` on any live stream powered by CUHZ Bot!*"
                ),
                "color": 65510,
                "footer": {
                    "text": "Planet CUHZ • Autonomous Community Promo Engine"
                }
            }
        ]
    }

    cmd = [
        "curl", "-sS", "-X", "POST",
        f"https://discord.com/api/v10/channels/{DISCORD_CLIPS_CHANNEL_ID}/messages",
        "-H", f"Authorization: Bot {token}",
        "-F", f"payload_json={json.dumps(payload)}",
        "-F", f"file=@{video_path};filename={video_path.name}"
    ]

    try:
        res = subprocess.check_output(cmd).decode("utf-8")
        data = json.loads(res)
        if "id" in data:
            print(f"[*] Successfully posted promo to Discord #cuhz-clips (Message ID: {data['id']})")
            return True
        else:
            print(f"[-] Discord API returned error: {res[:200]}")
            return False
    except Exception as e:
        print(f"[-] Failed to upload to Discord: {e}")
        return False


def main():
    print("=== Planet CUHZ Community Promo Compilation Engine ===")
    
    # Check for pending clips in DB
    pending = fetch_pending_clips(limit=5)
    
    # We also pair with available video assets in ~/Movies for immediate demonstration
    sample_movies = sorted(list(Path("/Users/william/Movies").glob("*.mkv")))
    
    clip_items = []
    featured_streamers = []
    featured_clippers = []
    clip_ids = []

    if pending and sample_movies:
        for idx, clip in enumerate(pending):
            movie_file = sample_movies[idx % len(sample_movies)]
            clip_items.append((movie_file, clip))
            featured_streamers.append(clip["channel"])
            featured_clippers.append(clip["clipped_by"])
            clip_ids.append(clip["id"])
    elif sample_movies:
        # Fallback to local community clips in ~/Movies
        default_metas = [
            {"channel": "planetcuhz", "clipped_by": "cuhz_crew", "title": "Insane Movement Tech"},
            {"channel": "four_a_reason", "clipped_by": "hypemaster", "title": "Clutch 3v3 Play"},
            {"channel": "rico2ez", "clipped_by": "vibechatter", "title": "Peak Comedy Timing"}
        ]
        for idx, m in enumerate(sample_movies[:3]):
            meta = default_metas[idx % len(default_metas)]
            clip_items.append((m, meta))
            featured_streamers.append(meta["channel"])
            featured_clippers.append(meta["clipped_by"])

    if not clip_items:
        print("[-] No clips available for compilation.")
        return

    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_video = OUTPUT_DIR / f"cuhz_community_promo_{timestamp}.mp4"

    print(f"[*] Compiling {len(clip_items)} clips into promo video...")
    build_compilation(clip_items, out_video)

    # Post finished compilation to Discord #cuhz-clips
    posted = post_to_discord(out_video, featured_streamers, featured_clippers)
    if posted and clip_ids:
        mark_clips_posted(clip_ids)

    print("=== Compilation & Promo Pipeline Complete! ===")


if __name__ == "__main__":
    main()
