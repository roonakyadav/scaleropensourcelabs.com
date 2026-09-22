// Post-restart smoke test.
//
//   node scripts/smoke.mjs
//
// A 200 on the page proves nothing. This dev server has twice served correct HTML
// while 404ing its own chunks, so nothing hydrated and every other check still
// passed — the theme toggle was dead, the reveals never ran, and the page looked
// entirely fine in a screenshot. So this asserts behaviour that only exists if
// JavaScript actually loaded and ran.
//
// It sweeps every route, because a single-page smoke test on a six-page site checks
// one sixth of it and prints "PASS".
//
// The client-side navigation checks near the end are regression tests for a specific
// bug introduced by moving Nav, Reveal and Outline into the shared layout: that
// layout does NOT remount between routes, so a mount-only effect keeps the first
// page's state forever. Reveal would stop marking sections and Outline would list the
// home page's sections on every other page. Neither is visible in a screenshot of a
// hard-loaded page — only navigating within the app shows it.

import { chromium } from "playwright";
import { ROUTES, SITE, assertOurSite } from "./assert-site.mjs";

const BASE = SITE.replace(/\/$/, "");
const b = await chromium.launch();
const pg = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const bad = [];
pg.on("response", (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(/^.*?\/_next/, "_next")}`);
});
pg.on("pageerror", (e) => bad.push(`pageerror ${String(e).slice(0, 200)}`));

let failed = 0;
const ok = (n, v) => {
  if (!v) failed++;
  console.log(`  ${v ? "PASS" : "FAIL"}  ${n}`);
};

// Selected by what they ARE, not by position. `nav button` used to be the theme
// toggle; adding the outline toggle made it the first match, so an earlier version of
// this file reported the theme control broken when it was fine.
const THEME = '[aria-label^="Theme:"]';
const OUTLINE = '[aria-controls="page-outline"]';
const JOIN = 'nav[aria-label="Main"] a[href^="/join"]';

// ---------------------------------------------------------------------------
// Every route, hard-loaded.

for (const route of ROUTES) {
  const before = bad.length;
  await pg.goto(BASE + route.path, { waitUntil: "networkidle" });
  await assertOurSite(pg);
  await pg.waitForTimeout(400);

  const state = await pg.evaluate(
    ({ joinSel, themeSel }) => {
      const join = document.querySelector(joinSel);
      const jr = join?.getBoundingClientRect();
      const theme = document.querySelector(themeSel);
      return {
        h1s: document.querySelectorAll("h1").length,
        // The persistent action must be present AND actually on screen at 44px, not
        // merely in the DOM. The previous nav silently clipped its last two items
        // into an unscrollable overflow, which is exactly this failure.
        joinVisible:
          !!jr && jr.width > 0 && jr.height >= 44 && jr.right <= window.innerWidth + 1,
        // Presence alone, for the app routes, where the assertion is that it is absent.
        joinPresent: !!join,
        hasSiteNav: !!document.querySelector('nav[aria-label="Main"]'),
        // Exactly one nav item may claim to be the current page.
        currentMarks: document.querySelectorAll(
          'nav[aria-label="Main"] [aria-current="page"]',
        ).length,
        hydrated: !!theme && getComputedStyle(theme.querySelector("span")).opacity === "1",
        sections: document.querySelectorAll("section[id]").length,
        mainH: !!document.querySelector("main#main"),
        canvases: document.querySelectorAll("canvas").length,
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      };
    },
    { joinSel: JOIN, themeSel: THEME },
  );

  const label = route.path.padEnd(14);
  ok(`${label} no failed requests`, bad.length === before);
  bad.slice(before, before + 3).forEach((l) => console.log("          " + l));
  ok(`${label} exactly one h1`, state.h1s === 1);
  ok(`${label} <main id="main"> for the skip link`, state.mainH);

  // THE MARKETING CHROME IS ASSERTED BOTH WAYS, and that is the point of the branch.
  // A signed-in route that grew a Join button would be the bug this whole split exists to
  // fix — a bar arguing the case for joining, shown to somebody who joined last month —
  // so its absence is checked rather than merely tolerated.
  if (route.app) {
    ok(`${label} no marketing nav on the app shell`, !state.hasSiteNav);
    ok(`${label} no Join button on the app shell`, !state.joinPresent);
  } else {
    ok(`${label} Join button visible at >=44px`, state.joinVisible);
    // Six pages mark themselves; /join and /privacy mark nothing. See assert-site.mjs.
    const wantCurrent = route.inNav ? 1 : 0;
    ok(
      `${label} nav current marks == ${wantCurrent}`,
      state.currentMarks === wantCurrent,
    );
  }

  // Both shells carry the theme control, so this stays the hydration probe everywhere.
  ok(`${label} hydrated (theme icon painted)`, state.hydrated);
  ok(`${label} no horizontal overflow`, state.docW <= state.winW + 1);
  ok(`${label} no canvas (3D removed)`, state.canvases === 0);
}

// ---------------------------------------------------------------------------
// Controls, on a page that has sections to outline.

await pg.goto(BASE + "/how-to-join", { waitUntil: "networkidle" });
await assertOurSite(pg);
await pg.waitForTimeout(400);

const themeBefore = await pg.evaluate(() =>
  document.documentElement.getAttribute("data-theme"),
);
await pg.click(THEME);
await pg.waitForTimeout(400);
ok(
  "theme toggle changes theme",
  themeBefore !==
    (await pg.evaluate(() => document.documentElement.getAttribute("data-theme"))),
);

ok(
  "outline absent until asked for",
  await pg.evaluate(() => !document.querySelector("#page-outline")),
);
await pg.click(OUTLINE);
await pg.waitForTimeout(400);
// Derived, not hardcoded. An earlier version asserted 14 and failed the moment a
// fifteenth section was legitimately added — the point is that the outline matches
// the page, not that the page has a particular number of sections.
ok(
  "outline lists every section on the page",
  await pg.evaluate(() => {
    const sections = document.querySelectorAll("section[id]").length;
    const links = document.querySelectorAll("#page-outline a").length;
    return sections > 0 && links === sections;
  }),
);

// ---------------------------------------------------------------------------
// Client-side navigation. The regression tests described at the top.

const afterNav = async (path) => {
  await pg.click(`nav[aria-label="Main"] a[href="${path}"]`);
  await pg.waitForFunction((p) => location.pathname === p, path, { timeout: 5000 });
  await pg.waitForTimeout(700);
  return pg.evaluate(() => {
    const sections = [...document.querySelectorAll("section[id]")].map((s) => s.id);
    const links = [...document.querySelectorAll("#page-outline a")].map((a) =>
      (a.getAttribute("href") || "").slice(1),
    );
    return {
      match: sections.length > 0 && sections.join(",") === links.join(","),
      sections: sections.length,
      links: links.length,
      // Reveal must have re-marked this page's sections. Without the pathname
      // dependency this is 0 on every page after the first.
      revealed: document.querySelectorAll("[data-reveal]").length,
      current: document.querySelectorAll('nav[aria-label="Main"] [aria-current="page"]')
        .length,
    };
  });
};

for (const path of ["/projects", "/hall-of-fame", "/"]) {
  const r = await afterNav(path);
  ok(`client-nav ${path.padEnd(14)} outline re-derived (${r.links}/${r.sections})`, r.match);
  ok(`client-nav ${path.padEnd(14)} reveal re-targeted (${r.revealed})`, r.revealed > 0);
  ok(`client-nav ${path.padEnd(14)} current page re-marked`, r.current === 1);
}

// ---------------------------------------------------------------------------
// The join form's path preselect, which every page's closing action relies on.

await pg.goto(`${BASE}/join?path=program-track`, { waitUntil: "networkidle" });
await assertOurSite(pg);
await pg.waitForTimeout(700);
// THE PRESELECT IS REACHABLE FROM A SIGNED-OUT BROWSER AGAIN, so it is asserted here
// again. It was dropped when /join was the sign-in gate: there was no #af-path to read
// until somebody had signed in with a real college Google account, which needs the Auth
// emulator and a popup, so the cheap suite could only assert that the gate rendered.
// Applying is anonymous now — the form ships to anybody who asks for the page — and the
// funnel's one silent failure is back within reach: a closing action that links to
// /join?path=<id> and lands on a form with nothing chosen.
//
// WHAT THIS REPLACES HAD BEEN RED SINCE THAT SPLIT, for exactly the reason the note
// further down this file warns about. It asserted that /join renders "sign in with your
// college account", which stopped being true the moment applying stopped requiring an
// account — so the suite has been saying the join page is broken while the join page was
// fine, which is how a team learns to ignore its own checks. The signed-in half of this
// flow is still covered by scripts/e2e-auth.mjs (`npm run e2e:auth`), against the
// emulators.
// JOINING IS SIGN-IN ONLY AGAIN, and these assertions moved with it rather than being
// deleted. The page held an anonymous application form for a spell; membership is an
// @sst.scaler.com address, which is the one thing that form could not check, so the door
// and the test are the same act now.
const joinState = await pg.evaluate(() => {
  const text = document.querySelector("main")?.innerText ?? "";
  return {
    configured: /continue with google|sign in with your college account/i.test(text),
    unconfigured: /sign-in is not set up here/i.test(text),
    hasFormFields:
      document.querySelectorAll("main input, main select, main textarea").length > 0,
    statesDomain: /sst\\.scaler\\.com/i.test(text),
  };
});

// CI intentionally runs without Firebase configuration. In that environment /join must
// show the honest "not configured" state instead of a fake sign-in control. In a configured
// deployment it must show the real college-account sign-in gate. Both states must remain
// form-free.
ok(
  "join shows a valid gate state",
  joinState.configured || joinState.unconfigured,
);
ok(
  "and no application fields survive on the page",
  !joinState.hasFormFields,
);
// THE ASSERTION THAT WOULD CATCH A REGRESSION HERE. A form reappearing on this page is
// the specific thing this change removed, so its absence is checked rather than assumed —
// zero inputs of any kind in the main column.
ok(
  "and no application fields survive on the page",
  (await pg.evaluate(
    () => document.querySelectorAll("main input, main select, main textarea").length,
  )) === 0,
);
ok(
  "join keeps ?path in the URL",
  new URL(pg.url()).searchParams.get("path") === "program-track",
);
// THE DOMAIN RULE IS ON THE PAGE, not just in the rules. It is the whole membership test
// and the one sentence a reader cannot afford to skim past, so a copy pass that removed it
// would leave people signing in with a personal Gmail and being refused with no warning.
ok(
  "and states the one address that can register",
  (await pg.evaluate(() =>
    /sst\.scaler\.com/i.test(document.querySelector("main")?.innerText ?? ""),
  )),
);
// The form must NOT be reachable without signing in. This is a UI assertion, not a
// security one — the boundary is firestore.rules — but a form rendering to a signed-out
// visitor would mean the gate had broken open.
ok(
  "the profile form is not rendered before sign-in",
  (await pg.evaluate(() => document.querySelectorAll("#pf-name, #pf-hostel").length)) === 0,
);

// ---------------------------------------------------------------------------
// The two signed-in routes, seen by somebody who is not signed in.
//
// THE FAILURE THIS CATCHES IS A FLASH, NOT A LEAK. Both routes are static HTML on a CDN
// and anybody can fetch them; what stops a stranger reading anybody's details is
// firestore.rules. What these assert is that neither route paints the wrong thing while
// it works out who you are — a static export ships before auth resolves, so a route that
// treats "still checking" as "signed out" shows a sign-in prompt to every returning
// member, and one that treats it as "signed in" renders an empty dashboard to a stranger.
// Signed out, the correct end state is the members-only card and no form.
for (const path of ["/onboarding", "/dashboard"]) {
  await pg.goto(BASE + path, { waitUntil: "networkidle" });
  await assertOurSite(pg);
  // Deliberately long. The point is the SETTLED state: a shorter wait would pass while
  // the page was still on its "checking your sign-in" card and prove nothing.
  await pg.waitForTimeout(1200);
  const label = path.padEnd(12);
  const text = await pg.evaluate(
    () => document.querySelector("main")?.innerText ?? "",
  );
  // TWO ACCEPTABLE END STATES, because this suite runs with and without a Firebase
  // config. With one, a signed-out reader is asked to sign in; without one — which is
  // how a contributor fixing a typo runs the site, and how CI runs it — the honest
  // answer is that there is nothing to sign in to. Asserting only the first would fail
  // on a machine with no .env.local for a reason that has nothing to do with the routes.
  // THREE ACCEPTABLE WORDINGS, because the two routes render two different cards and
  // the suite also runs with no Firebase config at all. /onboarding goes through
  // MemberOnly, which says "Sign in first."; /dashboard renders SignInCard, whose h1 is
  // "Sign in with your college account" — and that second one was missing here, so this
  // check has been red on /dashboard since the sign-in card moved onto that route. The
  // unconfigured wording stays: it is how CI runs, and how a contributor with no
  // .env.local runs the site.
  ok(
    `${label} settles on a signed-out state`,
    /sign in first|sign in with your college account|sign-in is not set up here/i.test(
      text,
    ),
  );
  // THE ONE THAT MATTERS. Landing on the "checking" card and staying there means the
  // auth state never resolved, which on a static route is indistinguishable from a dead
  // page — and it is what a botched redirect looks like.
  ok(
    `${label} does not settle on the checking card`,
    !/checking your sign-in|loading your dashboard/i.test(text),
  );
  ok(
    `${label} renders no form before sign-in`,
    (await pg.evaluate(() => document.querySelectorAll("#pf-name, #pf-hostel, #am-name").length)) === 0,
  );
}

await b.close();

// Non-zero on any failure, or CI passes while the site serves no JavaScript.
if (failed > 0) process.exitCode = 1;
