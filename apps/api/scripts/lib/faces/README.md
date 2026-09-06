# Seed portrait photos

Sixteen passport-shaped portraits, 320×400, used by `seed-demo.mjs` so demo
profiles have a face rather than a silhouette.

## Where they came from

They are **StyleGAN output from thispersondoesnotexist.com**. Every one depicts
a person who does not exist: there is nobody to have not consented, nobody to
be misrepresented by the invented age and community attached to them, and
nobody to object to being listed as looking for a husband.

That is the whole reason for using generated faces here. A matrimony profile is
a claim about a person, and a real photograph on a fabricated profile — a public
figure's publicity still, a stranger's holiday snap — is the exact shape of the
fraud these platforms spend their lives fighting.

## Before this ships

The copyright position on AI-generated images is unsettled and varies by
jurisdiction, and this source publishes no licence. That is an acceptable risk
for a local demo and **is worth checking before it goes in front of the
public**. If it does not survive that check, replacing them is a matter of
dropping different files in this folder with the same names — nothing outside
the seed reads them.

Real member photos never come through here. Those are uploaded through the app,
stored by the media driver and moderated before anyone else sees them.

## Naming

`female-0.jpg … female-8.jpg` and `male-0.jpg … male-6.jpg`. The seed cycles
through whichever set matches the profile's gender, so a bride never gets a
man's photograph. They were sorted by eye; there is no classifier involved.
