---
slug = "trainstop"
title = "Trading Contributions for Timmies"
description = "Certified Pavlov Moment"
created_date = "2022-04-30"
last_modified_date = "2022-04-30"
---

## I coach for Get Coding

[Get Coding](get-coding.ca) is not a bootcamp. I don't really like the
bootcamp style of teaching because people get left behind. Instead Get Coding
is a 1-on-1 system where a student is paired with a coach for a module and upon
completion of that module the student moves on to a new coach. This networks
students with coaches around the city and gives them diverse experience. It
ends up being cheaper than a bootcamp, because coaches have jobs outside of the
dojo.

Nobody is salaried and that makes the program a great value for the
students and a great value for the coaches who get a hiring pool of potential
references. I highly recommend it to aspiring students and coaches.

## Habbits are important

It takes a lot of soft-skills to be a good developer. I make that clear during
my sessions with students. However there is one soft-skill that can make the
difference between a hirable and not-so hirable developer and that's their
ability to form good habbits. A little bit of work every day snowballs into
results that are desirable to talent managers. Whether that be reading every
night before bed or committing every day (stay with me I'm getting there).

## 🟩 Green Square's aren't everything

As much as I loove 🟩🟩🟩 **I don't** think the sole reason some people get
hired is because of their contribution graph. I think it could be a good
indicator of grit. For example if someone has a consistent graph with little
spikes here and there, they're more likely to stand out because of their
habbits. There are many other factors hiring managers look for like followers,
location, language, and repository stats but if you're looking for something
to add on top of all of that a nice green chart is good to have.

![A GitHub contribution graph going from very few to a lot of commits](/blog-assets/good-contrib-graph.png)

## Trainstop

![A screenshot of Trainstop](/blog-assets/trainstop1.png)

I made Trainstop to motivate my students a little more by giving them a
currency whenever they completed a full week of committing. They can cash in
that money on the same website for gift cards for coffee or food. The majority
of my students immediately jumped on this and so did coaches.

If you miss a day you can still keep committing, because it isn't the days that
are counted it's the streak. You can commit from Wednesday-Wednesday or Sunday-
Sunday. It all gets counted the same.

## How it works

I hate hosting things. I hate maintaining things when they go down and exposing
myself and others to risks when they use my stuff. Instead I statically
generate wherever I can and use minimal Javascript. This frees so much hassle
with any project if you can get away with it.

Students contributions are counted from the start of the year. If you have a
streak of 7 days in a row, you get a MitchBuck! This can be used to cash in
[at the MitchShop](https://trainstop.mitchellhynes.com/shop) for lots of stuff.
To spend this, you must trigger a new website build via the `config.toml`:

```toml
[[buy]]
username = "urgithubusername"
deducted = 4
for = "timmies10"
```

The site is also rebuilt daily via Github Actions so I don't need to update it
at all. Building the site daily and when you buy something means that the site
is completly portable. If you wanted to host this somewhere, it would just need

- [x] A CD System
- [x] A way to host static files
- [x] A way for users to modify the code

In fact forking the project is enough to make your own Trainstop for your
own students. Just don't forget to merge any fixes upstream please ;)

## Conclusion

Trainstop was a fun project to build, and in the few months it's been in use
it's motivated some of my students to get into good habbits like working on
something every day. The project is also very easy to host yourself and I
encourage others to do so.
