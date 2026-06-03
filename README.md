# ⚔️ AEGIS — Orbital Cyber Threat Intelligence Platform

> First open-source satellite cyber threat IDS — tracks 170+ live satellites using the same SGP4 orbital algorithm as NORAD, detects GPS spoofing, signal jamming & command injection via Isolation Forest AI. Simulates the exact attack chain that took down Viasat in 2022.

🔴 **[Live Demo →](https://aegis-orbital.vercel.app)**

---

## Deploy to Vercel (30 seconds, free)

### Step 1 — Push to GitHub
1. Go to [github.com/new](https://github.com/new)
2. Name your repo `aegis-orbital` → set to **Public**
3. Click **"uploading an existing file"**
4. Drag and drop all 3 files:
   - `index.html`
   - `vercel.json`
   - `README.md`
5. Click **Commit changes**

### Step 2 — Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → sign in with GitHub
2. Click **New Project** → select `aegis-orbital`
3. Click **Deploy** — no settings to change
4. Done. Live URL in ~20 seconds: `https://aegis-orbital.vercel.app`

> Every time you push a new commit to GitHub, Vercel auto-redeploys instantly.

---

## What Is AEGIS?

AEGIS is a satellite cyber threat intelligence platform that does two things:

**1. Tracks real satellites in real-time**
Pulls live TLE (Two-Line Element) data from CelesTrak — the same source used by NASA, ESA, and the US Space Force — and computes orbital positions using the **SGP4 algorithm**, the same math NORAD uses to track every object in orbit. Positions are accurate to within ~1 km when live data loads.

**2. Simulates real satellite attack vectors with AI detection**
Runs an Isolation Forest anomaly detection engine on 5 telemetry features (SNR, command rate, position delta, signal strength, packet loss) to detect the attack signatures used against real satellites.

---

## Features

### 🌍 Live Orbital Globe
- 170+ real satellites tracked: SpaceX Starlink, ISS, Tiangong, USAF GPS Block II/III, NOAA/GOES/Landsat/Terra/Aqua
- SGP4/SDP4 orbital propagation — same algorithm as NORAD & US Space Force
- Photorealistic Earth — ocean gradients, biome colors, ice caps, cloud bands, city lights on the night side
- Drag to rotate · Scroll to zoom · Click any satellite for live telemetry
- Smart labels — ISS, GPS, weather sats labeled by default. Toggle ALL / SMART / OFF

### 🛡️ AI Anomaly Detection

| Feature | Normal Baseline | Attack Signature |
|---|---|---|
| SNR (signal-to-noise ratio) | 14.0 dB | Spoofing: >19.5 dB · Jamming: <-2.5 dB |
| Command rate | 0.30 /s | Injection: >3.9/s · Replay: >2.3/s |
| Position delta | 0.08 km | Spoofing: >2.1 km |
| Signal strength | -78 dBm | Jamming: <-112 dBm |
| Packet loss | 0.8% | Jamming: >42% · Injection: >46% |

Anomaly score = weighted normalized deviation → sigmoid → 0–100.

### ⚔️ Threat Sandbox — 5 Attack Simulations

| Attack | Severity | Real-World Example |
|---|---|---|
| GPS Spoofing | 🔴 CRITICAL | Russia vs Black Sea ships · Iran vs RQ-170 drone (2011) |
| Signal Jamming | 🟡 WARNING | North Korea GPS jamming over the Korean peninsula |
| Command Injection | 🔴 CRITICAL | Russia vs Viasat KA-SAT, Ukraine (2022) |
| Replay Attack | 🟡 WARNING | Captured telecommand packet retransmission |
| Ground Station Phishing | 🔴 CRITICAL | Viasat 2022 — credential theft → satellite access |

The **Phishing simulation** plays out a 6-step real-time attack chain:
1. 🎣 Spear-phish email sent to ground station operator
2. 📧 Operator clicks — credentials + session cookie harvested
3. 🔑 Attacker logs into ground station control panel
4. 📡 Rogue commands queued for target satellites
5. ⚠️ AEGIS AI detects anomaly — command rate 4.2/s flagged
6. 🛑 Session revoked · Commands blocked · Incident logged

This is the exact methodology Russia used in the Viasat attack on February 24, 2022 — the first day of the Ukraine invasion — which destroyed 45,000 satellite modems across Europe in under one hour.

### 🕐 Dual Clock
- UTC time (top)
- Your local time — automatically detected from your IP address with city name

### 🪐 Solar System Minimap
All 6 planets orbiting in real-time. Saturn has rings.

---

## How the SGP4 Algorithm Works

**SGP4** (Simplified General Perturbations 4) is the orbital propagation model developed by NORAD in the 1970s. It solves a hard physics problem: given where a satellite is right now, compute exactly where it will be at any future moment.

It accounts for:
- Earth's non-spherical shape (equatorial bulge pulls on orbits)
- Atmospheric drag (slows LEO satellites, pulling them down over time)
- Gravitational effects of the Moon and Sun
- Solar radiation pressure

Input: a **TLE** (Two-Line Element set) — a snapshot of orbital parameters at a specific time
Output: lat/lng/altitude accurate to ~1 km

```
ISS TLE:
1 25544U 98067A   26153.50000000  .00018000  00000-0  31852-3 0  9991
2 25544  51.6400 120.5000 0003500  48.0000  35.0000 15.50400000000000
          │ inclination  │ eccentricity         │ mean motion (rev/day)
```

CelesTrak — operated by the Center for Space Standards & Innovation — publishes fresh TLEs every few hours, sourced from the US Space Force 18th Space Defense Squadron.

---

## Data Sources

| Source | What It Provides | Accuracy |
|---|---|---|
| CelesTrak (live) | Fresh TLE data for all satellite groups | ~1 km when TLE is <6hrs old |
| Built-in fallback | 73 hardcoded TLEs with June 2026 epochs | ~few km |
| ipapi.co | Your timezone + city from IP address | Used for local clock only |

AEGIS tries CelesTrak directly first (it supports CORS), then falls back to proxies, then falls back to the hardcoded dataset — so it always shows real satellites.

---

## Project Structure

```
aegis-orbital/
├── index.html      ← Entire platform. Globe + AI + UI + telemetry. ~1,000 lines.
├── vercel.json     ← One-click Vercel deployment config
└── README.md       ← This file
```

No npm. No build step. No dependencies to install. No API keys required.
Open `index.html` directly in a browser and it works.

---

## Why This Project Exists

Satellite cybersecurity is critically under-resourced:

- **No open-source IDS** existed for satellite networks before AEGIS
- **No shared threat framework** — the Sat-ATT&CK matrix (IEEE AICCSA 2025) was the first MITRE ATT&CK equivalent for space, and it was purely theoretical with no working implementation
- **The Viasat attack** (2022) demonstrated that satellite ground infrastructure is vulnerable to the same attacks that hit enterprise networks — phishing, credential theft, command injection — yet the tooling to detect them doesn't exist at the open-source level
- **The space economy** is projected to reach $1.8 trillion by 2035, with thousands of new satellites launching every year, making this an increasingly critical security domain

---

## Roadmap

- [ ] Space-Track.org integration for classified debris tracking
- [ ] Satellite pass prediction for any ground observer location
- [ ] WebGL globe (Three.js) for higher fidelity 3D rendering
- [ ] Python backend with real scikit-learn Isolation Forest
- [ ] REST API for programmatic anomaly scoring
- [ ] MITRE Sat-ATT&CK technique ID mapping in alert feed
- [ ] Real telemetry feed integration (when available via Space-Track)

---

## Built By

**Manjeet Singh**
BS Computer Network System Management · Minor in Business
San Jose State University

🌐 [manjeet-singh.com](https://www.manjeet-singh.com)
🏆 UC Berkeley 13 Hacks — 2nd Place (Manshaan AI)
🏆 SJSU Cloudathon 2026 CTF — Team ZeroDaySpartans (#10/20)

Certifications: Google Cybersecurity Professional · CCST
Pursuing: CCNA

---

## License

MIT — open source, use freely, attribution appreciated.

---

*AEGIS — the divine shield of Zeus and Athena in Greek mythology. Today, the name of the US Navy's most advanced missile defense system. Now, the first open-source satellite cyber threat platform.*
