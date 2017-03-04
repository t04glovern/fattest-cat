#!/usr/bin/env node

const _       = require("lodash");
const request = require("request-promise");
const opener  = require("opener");
const Promise = require("bluebird");
const cheerio = require("cheerio");

require("colors");


const METRIC = process.argv.includes("--metric");
const GRAMS_PER_OZ = 28.3495;
const SFSPCA_BASE = "https://www.sfspca.org"
const ADOPTION_PAGE = `${SFSPCA_BASE}/adoptions/smalls`;

const fetchsmallsHelper = Promise.method((pageNumber, smallsSoFar) => {
  const url = pageNumber === 0 ? ADOPTION_PAGE : `${ADOPTION_PAGE}?page=${pageNumber}`
  return request.get(url)
    .then((adoptionsPage) => {
      const smalls = cheerio(adoptionsPage)
        .find("a")
        .filter((i, tag) => tag.attribs.href && tag.attribs.href.match(/adoptions\/pet-details\/\d+/))
        .map((i, tag) => `${SFSPCA_BASE}${tag.attribs.href}`)
        .toArray();
      if (!smalls || smalls.length === 0) {
        return smallsSoFar;
      } else {
        return fetchsmallsHelper(pageNumber + 1, smallsSoFar.concat(smalls));
      }
    })
    .catch((err) => {
      console.log("Error fetching smalls:", err);
      return smallsSoFar;
    });
});

console.log("Accessing San Francisco SPCA (Smalls Department)...");
fetchsmallsHelper(0, [])
  .then(_.uniq) // NO DOUBLE smalls
  .tap((smalls) => console.log(`Smalls information system accessed. ${smalls.length} smalls found. Beginning weighing process...`))
  .map((url) => {
    return request.get(url)
      // SPCA sometimes returns 403s for some smalls, ignore this.
      .catch((err) => err)
      .then((catPage) => {
        const $ = cheerio.load(catPage);
        const name = $(".field-name-title h1").text();
        const weightText = $(".field-name-field-animal-weight .field-item").text();
        const type = $(".field-name-field-animal-type .field-item").text().trim();
        const lbs = Number(/(\d+)lbs\./.exec(weightText)[1]);
        const oz = /(\d+)oz\./.test(weightText) ? Number(/(\d+)oz\./.exec(weightText)[1]) : 0;
        const weight = 16 * lbs + oz;
        const isFemale = $(".field-name-field-gender .field-item").text().trim() === "Female";

        console.log("Weighing a %s named %s", type.blue, name.green);
        return {name, type, lbs, oz, weight, isFemale, url}
      })
      // Null for smalls that cannot be parsed.
      .catch(() => {});
  })
  // Filter out unparsable smalls.
  .then(_.compact)
  .then((smalls) => {
    if (smalls.length === 0) {
      console.log("No smalls found. It is a sad day.".red.bold);
      return;
    }

    const highestWeight = _(smalls).map("weight").max();
    const fattestsmalls = _.filter(smalls, {weight: highestWeight});
    const names = _.map(fattestsmalls, "name");
    const tie = fattestsmalls.length > 1;

    const introText = (tie ? "The fattest smalls are" : "The fattest small is").yellow.bold;
    const nameText = (tie ? `${names.slice(0, -1).join(", ")} and ${_.last(names)}` : names[0]).green.underline.bold;
    const descriptionText = (tie ? "They each weigh" : (fattestsmalls[0].isFemale ? "She weighs" : "He weighs")).yellow.bold;
    const weightText = METRIC ?
      (`${Math.round(GRAMS_PER_OZ * highestWeight)} grams`).yellow.bold :
      (`${fattestsmalls[0].lbs} lbs and ${fattestsmalls[0].oz} oz.`).yellow.bold;
    const openText = (tie ? "Opening smalls profiles..." : "Opening small profile...").yellow.bold;

    console.log(`${introText} ${nameText}. ${descriptionText} ${weightText}. ${openText}`);
    setTimeout(() => _(fattestsmalls).map("url").each(opener), 3000);
  });
