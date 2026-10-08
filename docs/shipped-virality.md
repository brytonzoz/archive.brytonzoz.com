# Shipped 2026: what makes it spread

Research notes for the Shipped 2026 receipt printer (staging: https://shipped-staging.brytonzoz.com/).
Engagement numbers were pulled from the fxtwitter API on Oct 8, 2026. They are snapshots and will keep moving.

## 1. TL;DR

- All three big reference launches were **a native video of the thing working**, with a one-line hook and a short post. None of them relied on a link-preview card.
- The receipt is the product *and* the ad. Receiptify proved it: a downloadable receipt PNG, one tweet to about 20 followers, then more than a million uses in its first 24 hours.
- The small "enter your handle" tool (xerper) got **57 quotes against 129 likes**. That is the tell for a generator: people quote it with their own result. Shipped should be designed for the quote-post.
- X's published ranking code has **no explicit link penalty**. A link click is a small positive. But replies, quotes and copy-link shares are weighted far higher, so the image has to carry the post, and the link is just the way in.
- A sharer needs four things: a perfect timeline-sized image, one tap, prefilled text that flatters them, and a reason to tag someone.
- Posts are effectively dead after about 48 hours in For You. A two-week event needs a fresh beat every day or two, not one launch post.
- Bookmarks ran at about 65–95% of likes on the three big launches. People save "cool tool" posts. The print-and-mail rung can be pitched as the physical version of that bookmark.

## 2. Reference cases

### Offprint (Daniel Belfort)
[Post](https://x.com/danielbelfort/status/2090134913366319115). A physical magazine printed from everything you "save for later".
- **Format:** native video (93 s), no link in the post.
- **Hook:** "Introducing Offprint™. The physical magazine made from everything you 'save for later' but never actually go back to read. Find online, read offline. Print media is back!"
- **Numbers:** 3.71M views, 13.3k likes, 525 reposts, 590 quotes, 940 replies, 8.7k bookmarks. The author had about 5.6k followers.
- **Why it spread:** it names a guilty habit everyone shares (the unread save pile) and turns it into a physical object. Digital-to-paper nostalgia, plus a clean product video. The ratio of replies to reposts is high, so people argued about it and that kept it ranking. **This is the closest analogue to Shipped:** your online year, printed on paper.

### Melty (David Miller)
[Post](https://x.com/davidmilr/status/2106802998236078564). Make and play music mashups with friends in one click.
- **Format:** native video (44 s), no link in the post.
- **Hook:** "Create and play mashups with friends in one click. Introducing Melty!"
- **Numbers:** 1.48M views, 12.9k likes, 708 reposts, 318 quotes, 324 replies, 8.7k bookmarks. The author had about 1.6k followers.
- **Why it spread:** a 9-word hook made of three promises (create, with friends, one click), then a video that proves them. "With friends" is built into the pitch, so every share invites a second person. A small account still broke out, so the content did the work.

### Compositor (Robbie Tilton)
[Post](https://x.com/robbietilton/status/2100946395972976843). A free, open-source, Photoshop-like image editor.
- **Format:** native video (35 s) plus a link in the main post.
- **Hook:** "I built a Photoshop-like image editor… The entire app is 12MB. Photoshop is 6,455MB on my machine."
- **Numbers:** 2.30M views, 19.6k likes, 2.1k reposts, 454 quotes, 1.1k replies, 18.8k bookmarks. The author had about 26.6k followers.
- **Why it spread:** an enemy (the Adobe subscription), a concrete number that's easy to repeat (12MB vs 6,455MB), "free and open source", and an honest aside about AI. Bookmarks nearly equal likes, so it's a save-for-later tool. A link in the main post didn't stop it.

### Xerper (valor0x), the handle-generator pattern
[Post](https://x.com/valor0x/status/2088141292886962446). Enter your X username and a project name, and it shows the impressions you generated.
- **Format:** one screenshot (992×680) plus a link in the post.
- **Hook:** "I built a website that shows you how much impressions you've generated for any project. Just enter your X username, type in your project's name, done."
- **Numbers:** 41.7k views, 129 likes, 5 reposts, 57 quotes, 35 replies, 60 bookmarks.
- **Why it spread (modestly):** a personal number about *you*, plus a three-step "just enter your handle". The quote count is about 44% of likes. Most launches sit at 2–5%, which means people quote-posted their own results. The reach stayed small because the output wasn't a distinctive image and there was no demo video. Shipped needs the quote mechanic plus a much better artifact.

## 3. What spreads on X now

- **Shown results beat bare links.** X's open-source ranking ([xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)) has no URL penalty. A link click is a small positive weight (about 0.2), but replies (about 5, up to 15–20 from mutuals), copy-link shares (about 20) and quotes matter far more ([xDoctor](https://xdoctor.app/learn/p2-reach/link-deboosting), [reachmore](https://reachmore.co/blogs/twitter-x-algorithm-2026-explained), [savalle gist](https://gist.github.com/patricksavalle/4a087d243e9cbf99e597297f11735861)). A link-card post gives people a way out. A striking image gives them a reason to reply.
- **Native media isn't a cheat code**, but video and images win on dwell time. All three big launches were 35–93 s videos that show the product working.
- **Front-load everything.** A post stops being eligible for For You after about 48 hours, and the first hours decide most of it. Reposting yourself doesn't give it a second wave.
- **Year-in-review and receipt formats are a proven genre.** [Receiptify](https://studioforcreativeinquiry.org/project/receiptify) turned private data into a realistic receipt with a "get image" button: more than a million uses in its first 24 hours from a tweet to about 20 followers ([The Focus](https://www.thefocus.news/lifestyle/receiptify/)). Spotify Wrapped and GitHub Wrapped work the same way: an identity flex ("look what I did"), easy comparison ("rate mine"), and a fixed format so every share looks familiar.
- **Quote-posts and reply chains** are the generator loop: one person posts the tool, and others quote it with their own output.

## 4. What a sharer needs (checklist)

- [ ] A finished image, already rendered and sized for the timeline (1200×675 for 16:9, or a tall receipt for mobile), legible as a thumbnail.
- [ ] One tap: native share sheet with the PNG attached, or copy image, or save.
- [ ] Prefilled text that flatters them and is short, with their number in it ("shipped 14 things in 2026. receipt attached.").
- [ ] An identity flex: their name/handle big on the receipt, a total, a rank or "item count".
- [ ] A reason to tag someone ("print @someone's").
- [ ] A link that works but doesn't dominate. The image is the post.
- [ ] Nothing embarrassing: no maker branding, no "AI-powered", and an honest result when someone shipped very little.

## 5. Design references and what we take from each

- **Emil Kowalski** ([Great Animations](https://emilkowal.ski/ui/great-animations), [animations.dev](https://animations.dev), [Sonner](https://github.com/emilkowalski/sonner), [Vaul](https://github.com/emilkowalski/vaul)):
  - Use ease-out and keep most motion under 300 ms. Animate only transform and opacity.
  - Make animations interruptible: CSS transitions, not keyframes, for anything a user can reverse.
  - Never animate repeated keyboard actions.
  - Take from Vaul: drag-to-dismiss with velocity, for tearing the receipt off and tossing it.
  - Take from Sonner: stacking, for receipts landing on the pile.
  - The printer feed should be the one long animation, because it carries information (items appearing line by line). Everything else stays snappy.
- **vercel-labs/agent-skills** ([repo](https://github.com/vercel-labs/agent-skills)): the `web-design-guidelines` skill audits against [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines), covering focus states, `prefers-reduced-motion`, touch targets, and not blocking paste. Use it as the pre-launch review pass. There are also `react-view-transitions` and `react-best-practices`.
- **expo/skills** ([repo](https://github.com/expo/skills)): the `expo-animation` skill (co-written with Emil) asks, in order: should this animate, which thread does it run on, spring or timing, how does the gesture hand off velocity. Its "there is no hover" rule matters for a mobile-first product: every affordance lives in press and position.
- **twostraws / Hacking with Swift** ([sensory feedback](https://www.hackingwithswift.com/quick-start/swiftui/how-to-add-haptic-effects-using-sensory-feedback)): tie haptics to events (`.sensoryFeedback` on a state change) and use springs as the default. On the web that means `navigator.vibrate` ticks per printed line where it's supported (Android), plus sound that does the haptic job on iOS. Keep it a light tick, not a buzz.
- **Appllama** ([appllama-skills](https://github.com/Appllama/appllama-skills)): a design library of top-grossing apps plus an "app design skill". The useful parts are the anti-slop rules, "springs preserve finger velocity", and "record the whole flow and scrub it frame by frame". We should judge the flow from a real screen recording, not screenshots.
- **Bryton's four screenshots** from the earlier chat could not be found, so they aren't reflected here.

## 6. Implications for Shipped 2026

1. **Share image first.**
   - After printing, the primary button is Share. It calls the Web Share API with the receipt PNG attached (`navigator.share({ files })`), falling back to copy image, then save.
   - The secondary button is "Post on X". It opens an X intent with prefilled text and the link. The link stays in the post, but the attached image carries it.
2. **Quote-post friendly card.**
   - The 1200×675 og:image for each receipt URL is the receipt itself on a flat paper background, not a logo card.
   - Every receipt gets its own URL, so a quote of the launch post shows *their* receipt.
3. **Honest countdown.**
   - The two-week clock is real and server-timed, and identical everywhere ("printer shuts off in 13d 4h").
   - No fake "only 3 left". When it hits zero, printing closes and the archive is frozen.
   - The ending is the second launch moment: "the pile is sealed."
4. **The free rung is the hero.** Printing and tossing onto the pile needs no account, no email and no payment. The paid rungs come after the joy, never before it.
5. **Upgrades are fun, not salesy.**
   - "$5: we print this on real thermal paper and mail it" appears as a printed line item on the receipt itself.
   - Small sponsor slots from $1 read like tip-jar lines. The hero slot is an auction with the current bid printed.
   - Terse copy, no badges.
6. **The sponsor block is social proof.**
   - The 1 hero + 3×3 grid with QR codes shows real names. Empty slots print as "YOUR NAME HERE — $1".
   - A full block signals a live event. Sponsors get reach on every shared PNG, which gives them a reason to share too.
7. **Tag-a-friend.**
   - "Print @someone's" works for any handle, so people make receipts *for* friends and tag them.
   - That's the Melty "with friends" loop, and it drives the heavily weighted replies from mutuals.
8. **A flow you can screen-record.**
   - One mobile screen: type a handle, the printer whirs and feeds line by line with sound, the total prints, a tear sound, then flick the receipt onto the 3D pile.
   - It should fit in 10–30 s with no scrolling and no modals covering the paper.
   - Respect `prefers-reduced-motion` with an instant print and no physics.
9. **Launch plan, day 0 to 14** (each post is native video or image, with the link in the post or the first reply):
   - **Day 0:** the launch video (20–40 s screen recording of a well-known maker's receipt printing). Hook in Offprint style: "Your 2026, itemized. A receipt printer prints everything you shipped this year. 14 days, then it shuts off."
   - **Day 1:** quote-post the best user receipts. Reply to every quote.
   - **Day 2:** the first physical prints arrive. Show a photo or video of real thermal paper.
   - **Day 3:** "most items shipped" leaderboard image.
   - **Day 5:** hero sponsor bid update (the number is the hook).
   - **Day 7:** halfway. A time-lapse of the pile, plus "print @someone's" prompts.
   - **Days 9 and 11:** themed pulls, such as longest receipt, a solo dev's 40 repos, and funniest single item.
   - **Day 12:** "48 hours left". Honest, because it's true.
   - **Day 13:** last call for mail-order prints and the final sponsor bid.
   - **Day 14:** the printer shuts off. The sealed pile video goes out and the archive is permanent.

## 7. Sources

- Offprint post: https://x.com/danielbelfort/status/2090134913366319115 (via https://api.fxtwitter.com/danielbelfort/status/2090134913366319115)
- Melty post: https://x.com/davidmilr/status/2106802998236078564
- Compositor post: https://x.com/robbietilton/status/2100946395972976843
- Xerper post: https://x.com/valor0x/status/2088141292886962446
- X ranking code: https://github.com/xai-org/x-algorithm
- Link de-boosting analysis: https://xdoctor.app/learn/p2-reach/link-deboosting
- Reach guide from the published algorithm: https://gist.github.com/patricksavalle/4a087d243e9cbf99e597297f11735861
- X algorithm weights, 2026: https://reachmore.co/blogs/twitter-x-algorithm-2026-explained
- Receiptify: https://github.com/michellexliu/receiptify, https://studioforcreativeinquiry.org/project/receiptify, https://www.thefocus.news/lifestyle/receiptify/
- Emil Kowalski: https://emilkowal.ski/ui/great-animations, https://animations.dev, https://github.com/emilkowalski/sonner, https://github.com/emilkowalski/vaul
- Vercel agent skills: https://github.com/vercel-labs/agent-skills, https://github.com/vercel-labs/web-interface-guidelines
- Expo skills: https://github.com/expo/skills
- Hacking with Swift (haptics): https://www.hackingwithswift.com/quick-start/swiftui/how-to-add-haptic-effects-using-sensory-feedback
- Appllama: https://github.com/Appllama/appllama-skills, https://appllama.io/
