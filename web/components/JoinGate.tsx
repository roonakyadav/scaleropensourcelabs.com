"use client";

// The door. Sign in with a college Google account, and nothing else.
//
//   not configured  -> say so plainly. No button that cannot work.
//   still checking  -> a neutral card, so nobody is shown the wrong thing
//   signed out      -> the sign-in card
//   signed in       -> leave. /onboarding if there is no profile yet, /dashboard if
//                      there is; /dashboard makes that decision, so this just goes there.
//
// IT USED TO BE THE WHOLE FLOW — sign-in, the profile form and the finished profile, all
// four states in this one component, on this one marketing page. That was right when the
// signed-in experience was a summary card, and stopped being right the moment there was
// somewhere to go afterwards. What is left here is the one thing this page is for.
//
// `user === undefined` IS STILL ITS OWN STATE and still matters. It means the session is
// being restored, and rendering the sign-in card during that shows a sign-in prompt to
// somebody who is already signed in, every time they load the page.
//
// THE REDIRECT IS AN EFFECT, NOT A RENDER-TIME PUSH. Calling router.replace during render
// is a React error, and doing it before `user` resolves would bounce a signed-out reader
// off the page they came here for. `replace` rather than `push` so the back button from
// the dashboard does not land on a gate that immediately throws them forward again.
//
// ---------------------------------------------------------------------------------
// THE DESIGN, AND WHY IT IS THIS AND NOT SOMETHING CLEVERER.
//
// This card used to be a white rectangle with a chip, a heading, a paragraph, a button
// and a grey footnote — a login panel that would fit any SaaS product and shared nothing
// with the rest of the site, which is loud on purpose: electric blue, high-vis yellow,
// black keylines, hard offset shadows, monospace utility type.
//
// Two directions were considered first and rejected on the page's own terms:
//
//   * THE PULL REQUEST. Model joining as a PR against the club's roster — a branch
//     name, a checks list, "sign in to open the PR". It is the most club-native
//     metaphor available and the site already speaks git fluently. It is also
//     precisely wrong here: the headline six inches to the left says "Most people
//     arrive having never opened a pull request." A door that requires you to
//     understand pull requests contradicts the sentence promising you do not need to.
//
//   * THE TERMINAL. `$ osc join --account you@sst.scaler.com`, reusing the terminal
//     block the footer already carries. Rejected because the standing instruction on
//     this site is LESS techy, and /join is the page held up as the calm one. A
//     command prompt where the sign-in button goes is the opposite of that.
//
// What is here instead is two things, one loud and one quiet.
//
//   THE GATE PLATE is the loud one, and it is the only bold object on the card. The
//   single fact that decides whether a reader can join at all — the address must end
//   @sst.scaler.com — was previously the middle clause of a four-line paragraph.
//   It is now a yellow plate with a black keyline, in the same register as the JOIN
//   button in the nav. Black on #FFD600 is 14.9:1, the highest-contrast pair in the
//   palette, which is what licenses using the loudest colour on the site for the one
//   sentence a reader cannot afford to skim.
//
//   THE STEP SPINE is the quiet one. It replaces a "Step 1 of 2" chip, which counted
//   the steps without naming them: a reader could see a second step existed but not
//   what it would ask of them, which is the thing that decides whether they start at
//   all. Two steps, named, with the reached ones filled — and it is a real sequence, so
//   the numbering is carrying information rather than decorating.
//
// Everything else is deliberately unchanged and quiet: the card keeps `.card`'s pale
// border and diffuse shadow rather than the black keyline, because this stylesheet's
// own rule is that controls get the hard shadow and content panels do not — "if
// everything wore the hard shadow the page would be a wall of outlines with nothing to
// press". The plate and the button are the two things you can press or must read; they
// are the two things wearing the keyline.

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DevLoginSlot from "@/components/dev/DevLoginSlot";
import { useAuth } from "@/lib/auth";
import { DOMAIN } from "@/lib/profile";
import { LINKS } from "@/content/site";

/** The plate's edge: the black keyline, and DELIBERATELY NOT the offset shadow.
 *
 *  Two reasons, and the second is the one that decided it.
 *
 *  `.hard` — this stylesheet's keyline-and-shadow token for panels — carries
 *  `:hover { translate(2px, 2px) }` for the interactive ones, so a plate of text
 *  wearing it moves under the pointer like a button that does nothing when clicked.
 *
 *  But the shadow itself was the real problem. With it, the plate and the
 *  "Continue with Google" button four inches below were the same object: 2px black
 *  keyline, 4px hard offset, on a saturated fill. This stylesheet's rule is that the
 *  hard shadow marks a CONTROL — "controls get a black keyline and an unblurred
 *  shadow, content panels get a pale border and a diffuse one" — so two identical
 *  objects where exactly one is pressable is the ambiguity that rule exists to
 *  prevent. The keyline keeps the plate loud; the shadow now belongs to the button
 *  alone, which is the only thing on the card you can press.
 *
 *  Costs nothing in dark mode: on a #141822 card a black keyline and a black shadow
 *  are both close to invisible, and the yellow fill was already carrying the shape. */
const PLATE = "border-2 border-black";

/** The button's working state.
 *
 *  Not decoration: signInWithPopup can take a second or two to open anything, and on
 *  the redirect path the page is about to be replaced entirely. Without a moving
 *  indicator the reader's read is "my click did nothing", and the thing they do next is
 *  click again — which is how you get `auth/cancelled-popup-request`.
 *
 *  Under prefers-reduced-motion the global block at the foot of globals.css zeroes the
 *  duration, so this parks as a static ring and the label carries the meaning on its
 *  own. That is the correct outcome, not a degradation. */
function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      {/* A three-quarter arc rather than a full circle — a spinning full circle is
          indistinguishable from a stationary one. */}
      <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" strokeLinecap="round" />
    </svg>
  );
}

/** A mortarboard, because the rule this panel explains is "are you at this college".
 *  Inline rather than an icon font or an SVG file: the CSP is `img-src 'self' data:` and
 *  `font-src 'self'`, so anything fetched from elsewhere would be blocked, and one path
 *  is not worth a dependency. */
function CapIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4 2 9l10 5 10-5-10-5Z" />
      <path d="M6 11.5V16c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4.5" />
    </svg>
  );
}

/** Where you are, in two named steps.
 *
 *  An ordered list because it is one: `aria-current="step"` marks the live entry, so a
 *  screen reader gets the same "1 of 2, and the next one is about your details" the
 *  filled dots give everybody else. The connector is aria-hidden — it is a rule between
 *  two items, not a third item. */
export function Steps({ at }: { at: 1 | 2 }) {
  const steps = [
    { n: "01", name: "Sign in" },
    { n: "02", name: "Your details" },
  ] as const;

  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Where you are">
      {steps.map((s, i) => {
        const idx = i + 1;
        const done = idx < at;
        const live = idx === at;
        return (
          <li key={s.n} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={[
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-xs font-bold leading-none",
                  done || live
                    ? "bg-accent text-bg"
                    : // Dashed, not solid: a step you have not reached is not a box that
                      // is empty, it is one that has not been drawn yet.
                      "border border-dashed border-seam text-dust",
                ].join(" ")}
              >
                {done ? "✓" : s.n}
              </span>
              <span
                aria-current={live ? "step" : undefined}
                className={[
                  "font-mono text-label uppercase tracking-wider",
                  live ? "font-bold text-ink" : done ? "text-haze" : "text-dust",
                ].join(" ")}
              >
                {s.name}
              </span>
            </span>
            {/* A CONNECTOR JOINS TWO THINGS, so it has to disappear when they stop being
                side by side — otherwise it is a rule pointing at nothing, which is what
                it was at 320px.
                376px IS MEASURED, NOT PICKED. Sweeping the viewport 320→420 in 4px steps
                with the connector forced visible, the two steps sit on one row from
                376px up and on two rows below it. A round 360 was the first guess and
                was wrong by four steps of the sweep. */}
            {i === 0 && (
              <span aria-hidden className="hidden h-px w-5 bg-seam min-[376px]:block sm:w-8" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The card, minus the one thing that needs the query string. */
function Gate() {
  const { user, configured, busy, error, wrongAccount, signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  // THE HANDOFF. A signed-in reader has no business on this page, so they leave — and
  // they take the ?path= with them, because that is the whole reason it survives sign-in
  // in the first place. /dashboard decides whether they need onboarding first; this
  // component deliberately does not read the profile, so there is one place that owns
  // "has this member finished joining" rather than two that can disagree.
  //
  // `busy` IS IN THE CONDITION, AND IT IS NOT BELT AND BRACES. onAuthStateChanged fires
  // as soon as the credential lands, which is BEFORE signInWithPopup resolves and closes
  // the popup it opened. Navigating on the first of those two events tears down the
  // opener while the popup is still handing back its result, and the popup is then
  // orphaned — left open, on Google's domain, with the reader looking at it wondering
  // what to do. `busy` is set for exactly the span of that call, so waiting for it to
  // clear means the window has closed itself before this page goes anywhere.
  //
  // Found by driving the real thing: the popup stayed open on about one run in three, and
  // it looked like a broken dashboard three assertions later.
  const path = params.get("path");
  useEffect(() => {
    if (!user || busy) return;
    router.replace(path ? `/dashboard?path=${encodeURIComponent(path)}` : "/dashboard");
  }, [user, busy, path, router]);

  // ---------------------------------------------------------------- unconfigured
  if (!configured) {
    return (
      <div className="card rounded-panel bg-raise p-8 sm:p-10">
        <p className="text-display-md font-semibold">Sign-in is not set up here.</p>
        <p className="measure mt-4 text-body text-haze">
          This deployment has no Firebase configuration, so registration is switched off.
          When sign-in is available, only students with an <strong className="text-ink">@{DOMAIN}</strong>
          address can register. If you are running the site locally, see{" "}
          <code>web/.env.example</code>. If you are seeing this on the live site, that is a
          bug — please tell us.
        </p>
        <a href={`mailto:${LINKS.email}`} className="btn btn-secondary mt-6">
          Email the organisers
        </a>
      </div>
    );
  }

  // ------------------------------------------------- still checking, or leaving
  // The signed-in case renders this too rather than flashing the sign-in card for the
  // frame between the effect above firing and the navigation happening. It covers the
  // `busy` window as well, so a reader whose popup is still finishing sees "taking you
  // to your dashboard" rather than the button they just pressed.
  if (user === undefined || user) {
    return (
      // The spine renders here too, so the card does not reflow when the check
      // resolves into the sign-in state a fraction of a second later.
      <div className="card rounded-panel bg-raise p-8 sm:p-10" aria-busy="true">
        <Steps at={1} />
        <p className="mt-6 text-body text-haze">
          {user ? "Taking you to your dashboard…" : "Checking your sign-in…"}
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------- signed out
  return (
    <div className="card rounded-panel bg-raise p-8 sm:p-10">
      <Steps at={1} />

      <h2 className="mt-6 font-display text-display-md font-bold tracking-tight">
        Sign in with your college account
      </h2>
      <p className="mt-3 text-body text-haze">
        Use your college Google account to continue.
      </p>

      {/* FULL WIDTH, and it is the only control on the card, so it gets the whole
          column rather than sitting inline at its own text width. A single primary
          action that spans its container is unmissable and is a bigger tap target on
          a phone than the same label with padding around it. */}
      {/* NOT DISABLED WHILE BUSY, AND THAT IS THE FIX RATHER THAN AN OVERSIGHT.
          signInWithPopup does not reject promptly when somebody closes the Google
          window — it polls for closure, and measured here it took five to seven
          seconds to settle. A `disabled={busy}` therefore left the only control on
          the card dead for seven seconds after the reader closed the chooser to pick
          a different account, which is well past the point where somebody decides the
          site is broken and reloads.
          Clearing `busy` on window focus was tried first and abandoned: the focus
          event never arrived when the popup closed, so the fix could not be verified,
          and unverifiable code is worse than none.
          Leaving it pressable is safe because the code below already anticipates a
          second press — `auth/cancelled-popup-request` is one of the two codes the
          error handler swallows deliberately. Firebase cancels the stale attempt and
          opens a fresh chooser, which is exactly what the reader is asking for.
          aria-busy carries the state for a screen reader; the spinner and the label
          carry it for everybody else. */}
      <button
        type="button"
        onClick={() => void signIn()}
        aria-busy={busy}
        className="btn btn-primary mt-7 w-full gap-2.5"
      >
        {/* Three labels, because there are three states and they mean different
            things. "Redirecting to Google" is what is actually happening — the popup
            or the full-page redirect is being opened — and saying so is what stops a
            reader clicking twice.
            The refused label is the one that took a bug report to get right: pressing
            "Continue with Google" again reads like it will repeat what just failed,
            when in fact the chooser reopens and a different account can be picked. */}
        {busy ? (
          <>
            <Spinner />
            Redirecting to Google…
          </>
        ) : wrongAccount ? (
          "Choose a different account"
        ) : (
          "Continue with Google"
        )}
      </button>

      {error && (
        <div className="mt-5" role="alert">
          <p className="text-sm leading-relaxed text-ember">{error}</p>
          {/* A REFUSAL USED TO BE A DEAD END. Somebody signed into a personal Gmail on
              a shared laptop was told their address was wrong and left looking at the
              same button, with no hint that the fix is to pick another account. The
              button above now says so, and this line names what to look for. */}
          {wrongAccount && (
            <p className="mt-2 text-sm leading-relaxed text-dust">
              You signed in as{" "}
              <span className="font-mono text-haze">{wrongAccount}</span>. Press the
              button again and pick your college account from the list — Google will
              ask which one to use.
            </p>
          )}
        </div>
      )}

      {/* THE RULE, ON THE RULE. A hairline with the domain sitting in the break of it:
          the loudest colour on the site spent on the shortest possible string, which is
          the one string a reader cannot afford to skim past. It replaces a full yellow
          panel that said the same thing in three lines — the panel was carrying the
          explanation as well as the fact, and the explanation belongs in the box
          below, which is built to hold it. */}
      <div className="mt-8 flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-seam" />
        <span className={`${PLATE} rounded-full bg-pop px-3 py-1 font-mono text-sm font-bold uppercase tracking-wider text-black`}>
          @{DOMAIN}
        </span>
        <span className="h-px flex-1 bg-seam" />
      </div>
      {/* The pill above is aria-hidden because it is a graphic restatement of the
          sentence in the panel below — a screen reader hearing "at sst dot scaler dot
          com" with no verb attached learns nothing it is not about to be told. */}

      <div className="mt-6 rounded-tile border border-edge bg-sunk p-5">
        <div className="flex gap-4">
          {/* A FILLED ACCENT TILE, and the first attempt was --accent-soft on the
              reasoning that a saturated square would out-shout the heading beside it.
              Measured, that reasoning was wrong in the only way that matters: the icon
              on the soft tile came out at a comfortable 6.3:1, but the TILE against the
              panel behind it was 1.02:1 in light and 1.23:1 in dark. There was no tile
              — just an icon floating in the corner of the box.
              Filled accent with the ground colour knocked out of it is the same device
              as the step markers at the top of this card, so the two accent-filled
              objects on the card are one idea rather than two. 36px, not 40: enough to
              read as a tile, small enough not to argue with the heading. */}
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-inline bg-accent text-bg">
            <CapIcon />
          </span>
          <div>
            <h3 className="font-semibold text-ink">Who can sign in</h3>
            <p className="mt-2 text-sm leading-relaxed text-haze">
              Students with an <strong className="text-ink">@{DOMAIN}</strong> address.
              No other address can register, and that is the whole check — no fee, no
              interview, no prior experience.
            </p>
          </div>
        </div>
      </div>

      {/* Renders nothing unless an emulator is configured, and is not in the bundle at all
          when one is not. See components/dev/DevLoginSlot.tsx. */}
      <DevLoginSlot />

      {/* NO "NO COLLEGE ACCOUNT?" FALLBACK, and this reverses a judgement I made a
          turn earlier. I added an organisers' email here on the reasoning that a closed
          door should have a bell on it. The club's answer is that the door is the point:
          an @sst.scaler.com address IS the membership test, so somebody without one is
          not a student here, and offering them a way in invites exactly the conversation
          the restriction exists to avoid. The footer carries the organisers' address on
          every page for anyone who genuinely needs to reach the club. */}

      {/* THE THREE LINKS GO TO A PAGE THAT EXISTS. Google will not publish an OAuth
          consent screen without a reachable privacy policy, and a sign-in card is the
          one screen where "what happens to my details" is a live question rather than
          a formality — so they are anchors into the three sections of /privacy that
          answer it, not three separate documents we do not have. */}
      <div className="mt-8 border-t border-seam pt-5 text-center">
        {/* .tap on each link, and gap-y-2 to pay for it. The QA sweep measured these
            at 51x23, 42x23 and 96x23 — every one under the 44px touch floor, on both
            themes at mobile. `.tap` is this stylesheet's fix for exactly that: 14px of
            vertical padding with a matching negative margin, so the target grows to
            44px and nothing moves on screen.
            THE SEPARATORS ARE BORDERS NOW, NOT PIPE CHARACTERS. A "|" glyph in --seam
            measured 1.47:1 in light and 1.34:1 in dark against the 4.5 floor, and the
            honest reading of that is not "it is decorative, exempt it" — it is that a
            separator is a rule, and a rule drawn as text has to meet a text contrast
            bar it was never trying to meet. Drawn as a 1px border it is a rule, the
            checker treats it as one, and it looks the same. */}
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm">
          <Link href="/privacy#what-we-store" className="tap link-u text-haze">
            Privacy
          </Link>
          <span aria-hidden className="h-4 w-px bg-seam" />
          <Link href="/privacy#terms" className="tap link-u text-haze">
            Terms
          </Link>
          <span aria-hidden className="h-4 w-px bg-seam" />
          <Link href="/privacy#data-deletion" className="tap link-u text-haze">
            Data deletion
          </Link>
        </p>
        {/* The club, not the university. The club runs this site and owns what is on
            it; SST is where its members study, and signing their name to a student
            project would be claiming an endorsement nobody gave. */}
        <p className="mt-3 text-sm text-dust">
          © {new Date().getFullYear()} Scaler Open Source Club, a student club at
          Scaler School of Technology.
        </p>
      </div>
    </div>
  );
}

export default function JoinGate() {
  // useSearchParams needs a Suspense boundary, or `next build` refuses to prerender this
  // route — at BUILD time rather than at runtime, which is the good version of that
  // error. The fallback reserves roughly the card's height so nothing jumps.
  return (
    <Suspense fallback={<div className="h-[38rem]" aria-hidden />}>
      <Gate />
    </Suspense>
  );
}
