# Sound Review Live Playwright Test

Use this flow whenever you need to verify the sound review UI on the live site.

## Target

- Site: `https://zhenchuan.renstoolbox.com`
- Page: `/ability-editor?tab=soundReview`
- Designated live test username: `catcake`

## Credentials

- Pass the approved live credentials through environment variables.
- Do not hardcode passwords in repo files.

## Required Variables

```bash
export PLAYWRIGHT_BASE_URL=https://zhenchuan.renstoolbox.com
export ZHENCHUAN_TEST_USERNAME=catcake
export ZHENCHUAN_TEST_PASSWORD='<current approved password>'
```

## Run

```bash
cd /home/ubuntu/zhenchuan/frontend
npx playwright test tests/sound-review.live.spec.ts --project=chromium
```

## What This Must Prove

- Login succeeds on the live site.
- The sound review tab opens without a client-side crash.
- The page shows grouped sound review content, not a blank/error screen.
- The three decision columns are visible: `需要继续处理`, `未决定`, `音效可用`.
- At least one `需要继续处理` action button and one `音效可用` action button are visible.

## Notes

- This test is intentionally aimed at the live deployment because localhost can pass while the deployed bundle still breaks.
- The spec writes a screenshot artifact so the rendered board can be inspected after the run.