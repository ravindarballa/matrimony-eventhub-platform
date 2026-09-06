# Seed portrait photos

`seed-demo.mjs` reads every image in `female/` and `male/` and cycles through
whichever set matches a profile's gender, so a bride is never shown a man's
photograph. Any filename works and `.jpg`, `.jpeg`, `.png` and `.webp` are all
accepted — replacing the set is dropping files in and re-running `npm run seed`.

Empty the folders and the seed falls back to drawn silhouettes. It never fails
for want of a photograph.

## What is in here now

Sixteen **StyleGAN portraits from thispersondoesnotexist.com**, cropped to
320×400. Every one depicts a person who does not exist.

That is the point, not a convenience. A matrimony profile is a claim about a
person. A real photograph on a fabricated profile attaches a real, identifiable
person to an invented age, an invented community and a "Send interest" button
they never agreed to — which is the exact shape of the fraud these platforms
spend their lives fighting. Publicity stills of actors are the worst version of
it, being both non-consensual and somebody else's copyright.

**They are also mostly European.** The model behind that source is trained on
FFHQ, and across sixty samples only three or four read as plausibly South Asian.
For a Telugu matrimony product that is a poor fit, and it is the reason to
replace them.

## Replacing them with Indian portraits

Anything rights-cleared works. Two routes that stay clear of the problem above:

- **Synthetic faces with demographic control** — generated.photos and similar
  let you filter by ethnicity and age, and the faces are of nobody real. Check
  the tier: free usually requires attribution, commercial use is paid.
- **Licensed stock** — a South Asian portrait pack from any stock library.
  ImagesBazaar and similar specialise in Indian imagery. Model releases are what
  you are paying for.

Whichever you choose, drop the files into `female/` and `male/` and re-seed.

## Before this is public

The copyright position on AI-generated images is unsettled and the current
source publishes no licence. Acceptable for a local demo, worth settling before
it faces anyone.

Real member photos never come through here. Those are uploaded through the app,
stored by the media driver, and moderated before anyone else can see them.
