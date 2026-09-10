# Chrome Web Store Listing Template

> Template for Flint Apply extension submission. Do not submit until manual
> review gate passes (login + save JD + tailor in Flint Apply + autofill smoke).

---

## Name

Flint Apply — Resume Tailoring

## Short description (132 chars max)

Capture job descriptions from LinkedIn, Greenhouse, and more. Tailor your resume in Flint Apply in one click.

## Category

Productivity

## Language

English (United States)

## Detailed description

Flint Apply helps you tailor your resume to every job posting. This extension
captures the full job description from supported job boards and sends it to your
Flint Apply account so you can run the tailoring wizard without copy-paste.

**How it works**
1. Browse to a job posting on LinkedIn, Greenhouse, Lever, Ashby, or similar.
2. Open the Flint Apply extension (floating panel or toolbar).
3. Click **Save job** to store the job description in your account.
4. Click **Tailor in Flint Apply** to open the web app with the JD pre-filled.
5. After tailoring, use **Autofill (beta)** on supported application forms.

**Requirements**
- A Flint Apply account
- Flint Apply web app (flintapply.com or your team's deployment)

**Privacy**
- Job description text is sent only to Flint Apply servers for your account.
- We do not capture audio, video, or screen content from your browser.
- See the Flint Apply privacy policy on the web app.

## Screenshots

> Add 1280×800 or 640×400 screenshots before submission.
> Suggested: login, saved job with Tailor button, JD step in web wizard, autofill overlay.

## Permissions justification

| Permission | Justification |
|---|---|
| `storage` | Store authentication tokens locally so users stay logged in |
| `activeTab` | Read the URL and page content of the active job page |
| `scripting` | Inject JD extraction and autofill scripts on demand |
| `alarms` | Refresh authentication tokens in the background |
| `identity` | Google sign-in via Chrome identity API |
| `tabs` / `webNavigation` | OAuth sign-in tab flow |

## Host permissions justification

| Host | Justification |
|---|---|
| `http://localhost:8000/*`, `http://localhost:8001/*` | Development / staging API |
| `http://localhost:3100/*`, `http://localhost:3001/*` | Development / staging web app |
| `https://www.linkedin.com/jobs/*` | Extract job descriptions |
| `https://*.greenhouse.io/*` | Extract job descriptions and autofill forms |
| Additional ATS hosts | Autofill on Lever, Ashby, Workday, and similar |

## Known limitations

- **TOTP not supported on extension login.** Users with two-factor authentication
  must sign in on the Flint Apply website or temporarily disable 2FA for extension login.
- **Desktop interview prep** (`Prep in Flint`) is disabled until the separate
  Flint desktop app is publicly available.
- **Autofill is beta** and best-effort on LinkedIn Easy Apply and some ATS variants.
