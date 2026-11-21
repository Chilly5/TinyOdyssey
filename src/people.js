// Who everyone is. Each of the little people (and their animals) can be asked about: a name,
// a trade, what they are doing at this moment and something of their life. None of it is
// stored: it is made, the same every time, from the number each one was given when the world
// was peopled (life.js), the kind of figure it is, and where its path lies.

import { mulberry32 } from './util.js';

const MEN = ['Alexios', 'Nikandros', 'Theron', 'Lysandros', 'Kleon', 'Damon', 'Philon', 'Agathon', 'Timaios', 'Xanthos', 'Eumenes', 'Kallias', 'Myron', 'Straton', 'Hieron', 'Menon', 'Dorieus', 'Phaidros', 'Aristos', 'Leandros', 'Pyrrhos', 'Zenon', 'Hermon', 'Glaukos', 'Polydoros', 'Simon', 'Lykos', 'Praxis', 'Telamon', 'Charmides', 'Epiktetos', 'Nikias', 'Sosias', 'Kephalos', 'Diokles', 'Anaxis'];
const WOMEN = ['Kallisto', 'Thais', 'Myrto', 'Chloe', 'Daphne', 'Ione', 'Melitta', 'Xanthe', 'Korinna', 'Aglaia', 'Eudora', 'Nikaia', 'Theano', 'Phoibe', 'Rhodope', 'Kleio', 'Anthea', 'Timo', 'Galene', 'Halia', 'Praxilla', 'Erinna', 'Zoe', 'Nysa', 'Philinna', 'Doris', 'Lyra', 'Hedeia', 'Mika', 'Sostrate', 'Gorgo', 'Arete', 'Kleitagora', 'Nannion', 'Elpis', 'Baukis'];

// A trade, and what a day of it is like. {He}, {he}, {his}, {him} are filled in for whoever has it.
const TRADES_M = [
  ['Potter', '{He} throws forty cups on a good day and signs none of them.'],
  ['Baker', '{He} is up before the lamps go out, and asleep by the time the bread is eaten.'],
  ['Fishmonger', '{He} can tell yesterday\'s catch from across the street and assumes everyone else can too.'],
  ['Sandal-maker', '{He} judges people by their feet and is seldom wrong.'],
  ['Stonemason', '{He} has cut the same block of limestone into three different buildings as they fell down in turn.'],
  ['Oil-seller', '{He} keeps three grades of oil and one honest measure.'],
  ['Carpenter', '{He} builds doors, carts and coffins, and charges the same for all three.'],
  ['Wine-seller', '{He} waters the wine exactly as much as the law allows.'],
  ['Smith', '{He} has not had hair on {his} forearms since he was sixteen.'],
  ['Scribe', '{He} writes other people\'s letters and has opinions about all of them.'],
  ['Sponge-diver', '{He} can hold {his} breath longer than a quarrel lasts.'],
  ['Barber', '{He} hears everything first and repeats it a little improved.'],
  ['Tanner', '{He} lives outside the walls, by general request.'],
  ['Net-mender', '{He} mends nets with his eyes shut and talks the whole time.'],
  ['Lamp-maker', '{He} sells light by the handful and goes home in the dark.'],
  ['Bronze-caster', '{He} has poured one statue of Apollo and forty of other people\'s grandfathers.'],
];
const TRADES_F = [
  ['Weaver', '{He} can price a cloak from the far side of the market.'],
  ['Baker', '{He} bakes with barley when the wheat ships are late, and says nothing about it.'],
  ['Midwife', '{He} has delivered half the street and scolded the other half.'],
  ['Herb-seller', '{He} sells thyme for the pot and other things for other troubles.'],
  ['Water-carrier', '{He} makes eleven trips to the spring a day and knows who was there before {him}.'],
  ['Cheese-seller', '{He} keeps goats on the hill and a stall by the gate.'],
  ['Dyer', '{His} hands have been three colours since {he} was a girl.'],
  ['Flute-player', '{He} plays at weddings and funerals and is paid better at funerals.'],
  ['Perfumer', '{He} mixes iris, myrrh and marjoram, and will not say in what order.'],
  ['Wool-spinner', '{He} spins while walking, talking and, {his} family swears, sleeping.'],
  ['Innkeeper', '{He} knows the news from three cities before the magistrates do.'],
  ['Honey-seller', '{He} keeps forty hives and has been stung in every one of them.'],
  ['Fig-seller', '{He} dries figs on the roof and counts them every evening.'],
  ['Laundress', '{He} knows the state of every household by its linen.'],
];
// Family: what can be said of anyone, of the young, and of those old enough to have a household.
// The young have no trade yet, and the old have laid theirs down.
const YOUNG = [
  '{He} is supposed to be minding the goats.', '{He} knows every roof in the quarter that can be climbed.', '{He} is learning letters from a tutor who falls asleep.',
  '{He} can whistle through a blade of grass, which is the envy of the street.', '{He} is saving knucklebones in a jar and will not say how many.',
  '{He} has been told twice today to fetch water and has not yet gone.', '{He} wants to be a ship\'s captain, or failing that a horse.',
];
const OLD = [
  '{He} remembers when the harbour wall was a row of stakes.', '{He} has buried a spouse, two oxen and most of {his} arguments.', '{He} sits by the well most mornings and is consulted on everything.',
  '{He} walks the same round each day and is put out if a stall has moved.', '{He} tells the story of the great storm differently each year, and better.',
  '{He} gave the workshop to a son-in-law and visits it daily to see what is being done wrong.',
];
const KIN = [
  '{He} is the youngest of five.', '{He} has a twin whom {he} has not spoken to since the inheritance.',
  '{He} was a foundling, left at the temple steps in a good blanket.', '{He} has a brother rowing in the fleet and a sister married in the next town.',
  '{His} father had the trade before {him}, and {his} father before that.', '{He} keeps an old dog that keeps {him} in turn.',
];
const KIN_YOUNG = [
  '{He} lives with a grandmother who remembers the last war and brings it up.', '{He} is promised to someone in the next village and has met them twice.',
  '{He} is the first of the family to leave the farm.', '{He} still sleeps under {his} parents\' roof and is reminded of it.',
];
const KIN_CHILD = [
  '{He} is the youngest of five.', '{He} has an older sister who is in charge of {him}, in theory.', '{He} lives with an aunt above the dyer\'s.',
  '{He} has a twin, and the two of them are seldom both where they should be.', '{His} father is away with the fleet this year.',
];
const KIN_GROWN = [
  '{He} has two daughters and a son who wants to go to sea.', '{He} was widowed young and did not marry again.', '{He} married across the valley, which the village still discusses.',
  '{He} is raising a nephew along with {his} own three.', '{He} has one child, late and much indulged.', '{He} has outlived two houses and one roof.',
];
const HOPES = [
  '{He} is saving for a mule.', '{He} worries that the rains are late.', '{He} owes the temple a debt and pays it off in instalments of intention.',
  '{He} means to see the Games at Olympia once before {he} dies.', '{He} has a lawsuit about a boundary stone that is now in its ninth year.',
  '{He} wants a house with a second storey and a door that locks.', '{He} is teaching {him}self to read from the inscriptions in the market.',
  '{He} dreams, most nights, of a ship {he} has never seen.', '{He} has promised a goat to Hermes if this year goes well.',
  '{He} would like, just once, to win an argument with {his} mother.', '{He} thinks about moving to the coast and has thought about it for twenty years.',
  '{He} is quietly sure the oracle meant {him}.', '{He} keeps a jar of coins buried under the hearth and digs it up to count them.',
  '{He} has never left the district and sees no reason to start.',
];
// Something of the place rubbed off on them.
const LOCAL = {
  athens: ['{He} swears the owl on the Acropolis looked straight at {him} the day {his} first child was born.', '{He} votes in every assembly and regrets most of them.', '{He} still argues that Poseidon\'s salt spring was the better gift.'],
  sparta: ['{He} was sent to the barracks at seven and still sleeps on reeds.', '{He} has said perhaps forty words this month and thinks it was too many.', '{He} finds the black broth perfectly good and cannot see the fuss.'],
  corinth: ['{He} has watched Sisyphus push that stone since childhood and still stops to look.', '{He} takes a toll from everyone crossing the Isthmus, including {his} cousins.'],
  thebes: ['{He} will not answer riddles, on principle.', '{He} can name all seven gates and the champion who fell at each.'],
  mycenae: ['{He} keeps well clear of the Lion Gate after dark.', '{He} says the palace has been quiet since the king came home, and does not say more.'],
  troy: ['{He} says the horse is far too big to be a gift, and nobody listens.', '{He} has not seen the sea without ships in it for ten years.'],
  knossos: ['{He} sells thread to visitors going into the Labyrinth, payment in advance.', '{He} hears the bull under the floor on still nights and has stopped mentioning it.'],
  delphi: ['{He} has asked the oracle three questions and understood none of the answers.', '{He} rents rooms to pilgrims and has heard every prophecy second-hand.'],
  olympia: ['{He} counts time in Games: four years to the next, eight since the wrestler from Kroton.', '{He} trains at dawn on the track and pretends the banks are full.'],
  ithaca: ['{He} still looks at the harbour every morning for a sail that is twenty years late.', '{He} thinks the suitors eat too much and has done the arithmetic.'],
  delos: ['{He} was not born on the island: nobody is allowed to be.', '{He} sells doves to pilgrims and feeds the ones that come back.'],
  pylos: ['{He} has heard old Nestor tell the same story four ways.'],
  iolcos: ['{He} helped caulk the Argo and has told the story at every wedding since.'],
  lemnos: ['{He} says the forge under the mountain keeps the floors warm in winter.'],
  dodona: ['{He} listens to the oak when the wind is in it, and writes down what it says.'],
  naxos: ['{He} claims the wine here is the reason the god stayed.'],
  rhodes: ['{He} has sailed between the Colossus\'s legs so often {he} no longer looks up.'],
  ephesus: ['{He} sells little silver temples to visitors and big promises with them.'],
};
const ANYWHERE = [
  '{He} has an opinion about every one of the gods and shares it only indoors.', '{He} once saw a centaur at the edge of the wood, or possibly a man on a horse.',
  '{He} pours the first drop of every cup on the ground, for whoever is listening.', '{He} never passes a crossroads without leaving something for Hekate.',
  '{He} can recite the Catalogue of Ships and will, if given wine.', '{He} was told as a child that the mountains are sleeping giants and has not ruled it out.',
];

const GOODS = ['olive oil', 'wine in pitched jars', 'purple cloth', 'salt fish', 'honey', 'obsidian blades', 'painted pots', 'bronze pins and mirrors', 'dried figs', 'raw wool', 'tin from the west', 'incense'];
const LOADS = ['cut stone', 'roof timber', 'barley in sacks', 'amphorae packed in straw', 'firewood', 'a millstone', 'marble for a temple that is behind schedule'];
const CROPS = ['barley', 'beans', 'vines', 'onions', 'chickpeas', 'lentils'];
const PRODUCE = ['a basket of figs', 'two cheeses', 'a sack of barley', 'a jar of olives', 'six hens', 'a kid goat'];
const REASONS = ['to see a sister', 'to settle a debt', 'to buy a mule', 'for a wedding', 'to ask about work', 'to see a doctor about a tooth', 'to fetch a runaway nephew', 'to make an offering that is overdue', 'to sell a field'];
const ERRANDS = ['to buy lamp oil', 'looking for a man who owes money', 'on the way to the fountain', 'taking a cloak to be mended', 'to hear the news at the barber\'s', 'carrying supper to a relative', 'to settle a bet', 'looking for a lost goat, in town, without much hope'];
const HAGGLE = ['arguing the price of figs', 'waiting for the bread to come out', 'buying fish and smelling each one first', 'weighing wool against a suspicious set of weights', 'pretending to walk away from a bargain', 'listening to a quarrel and choosing a side', 'buying nothing and enjoying it'];
const BEASTS = {
  sheep: ['A sheep', 'ewe'], goat: ['A goat', 'goat'], ox: ['An ox', 'ox'], bull: ['A bull', 'bull'], horse: ['A horse', 'horse'], horse_white: ['A white horse', 'horse'],
  donkey: ['A donkey', 'donkey'], deer: ['A deer', 'deer'], boar: ['A wild boar', 'boar'], wolf: ['A wolf', 'wolf'], lion: ['A lion', 'lion'],
};
const WILD = {
  satyr: ['A satyr', 'Following the nearest music, or failing that the nearest wine.', 'He has goat\'s legs, a horse\'s tail and no fixed occupation. The nymphs know him by name and wish they did not.'],
  centaur: ['A centaur', 'Galloping the high pastures of Pelion.', 'Half the herd are wild and quarrelsome. The other half is Chiron, who taught Achilles and Jason and despairs of the rest.'],
  cyclops: ['A Cyclops', 'Counting his sheep, by feel.', 'One eye, no laws, no ships and no neighbours he would call friends. He makes a good cheese.'],
  harpy: ['A Harpy', 'Circling for something to snatch.', 'A storm wind with a woman\'s face. She took old Phineus\'s dinner every day for years, until the sons of the North Wind chased her off.'],
  griffin: ['A griffin', 'Guarding gold that nobody else can find.', 'A lion behind and an eagle in front, and the temper of both.'],
  pegasus: ['Pegasus', 'Flying, because he can.', 'Born from Medusa\'s blood, tamed by Bellerophon with a golden bridle, and stabled now with Zeus.'],
  eagle: ['An eagle', 'Riding the wind off the mountain.', 'Zeus\'s bird. It is polite to assume it is on an errand.'],
  heracles: ['Heracles', 'On his way to the next labour.', 'Twelve labours for a cousin he despises: a lion, a hydra, a hind, a boar, some stables, and more to come. He walks everywhere.'],
  talos: ['Talos', 'Walking his rounds of Crete, three times a day.', 'A man of bronze made by Hephaistos to guard the island. He throws rocks at ships he does not recognise, which is most of them.'],
  dancer: ['A dancer', 'Dancing in the ring.', 'The dance is older than the town. Nobody alive chose the steps, and nobody has thought of changing them.'],
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const say = (s, f) => s.replace(/\{He\}/g, f ? 'She' : 'He').replace(/\{he\}/g, f ? 'she' : 'he').replace(/\{His\}/g, f ? 'Her' : 'His').replace(/\{his\}/g, f ? 'her' : 'his').replace(/\{him\}/g, f ? 'her' : 'him');

// nameOf: what a place is called, from its id. Returns who(m): the person (or animal) behind a mover.
// isTown: whether a place is somewhere people live (a cave or a shrine is not anyone's home).
export function createPeople(nameOf, isTown = () => true) {
  const place = (id) => nameOf(id) || 'the next town';

  function who(m) {
    if (m.who) return m.who;
    const r = mulberry32(0x9e3779b1 ^ Math.imul(m.id + 17, 2654435761));
    const pick = (list) => list[Math.floor(r() * list.length)];
    const c = m.ctx || {}, kind = m.kind;
    const lead = c.lead ? who(c.lead) : null;
    const town = c.town ? place(c.town) : c.to ? place(c.to) : null;

    // --- Animals and creatures out of the stories: a short card ---
    if (WILD[kind]) {
      const [name, now, life] = WILD[kind];
      return (m.who = { name, title: c.name ? `One of the ${c.name}` : 'Out of the old stories', now: () => now, life });
    }
    if (BEASTS[kind]) {
      const [name, word] = BEASTS[kind];
      let title = 'Belongs to nobody', now = 'Grazing, and keeping an eye on you.', life = `A ${word} with no owner and no plans beyond the next patch of shade.`;
      if (c.role === 'pack' && lead) {
        title = `${lead.first}'s donkey`;
        now = `Carrying ${lead.first}'s ${lead.goods || 'goods'} to ${place(c.to)}, with reservations.`;
        life = `${pick(['Bought at the fair for more than it was worth.', 'Inherited, along with the debts.', 'Won at dice and regretted since.'])} It knows the road better than its master and stops at every spring to prove it.`;
      } else if (c.role === 'flock' && lead) {
        title = `One of ${lead.first}'s flock`;
        now = `Following ${lead.first} along the road, more or less.`;
        life = `It has been counted twice today already. ${pick(['It is the one that always strays.', 'It has a bell, and is proud of the bell.', 'It was a bottle-fed lamb and still expects service.'])}`;
      } else if (c.where === 'herd') {
        title = c.keeper ? 'One of a kept herd' : 'One of a wild herd';
        now = `Grazing with ${Math.max(1, (c.n || 2) - 1)} others${c.keeper ? ', under a shepherd\'s eye' : ''}.`;
        life = kind === 'lion' || kind === 'wolf' || kind === 'boar' ? `The farmers for a day's walk around know this ${word} by its tracks, and bring their animals in at dusk.` : `It knows every spring on this hillside and the hour the shade reaches each one.`;
      } else if (c.where === 'field') {
        title = `A plough ox of ${town}`;
        now = `Pulling a plough outside ${town}, one furrow at a time.`;
        life = 'It has ploughed this field for nine seasons and turns at the end of the row without being told.';
      } else if (c.where === 'street') {
        title = `A donkey of ${town}`;
        now = `Standing in the street in ${town}, waiting for someone to remember it.`;
        life = 'It carries water in the morning and firewood at night, and in between it thinks its own thoughts.';
      } else if (c.where === 'myth') {
        title = 'Out of the old stories';
        now = kind === 'bull' ? 'Pawing the ground.' : 'Keeping to its own country.';
        life = kind === 'lion' ? 'Its hide turns bronze and iron alike. Heracles will have to think of something else.' : kind === 'boar' ? 'It has ruined three harvests and a king\'s temper.' : kind === 'bull' ? 'It came out of the sea as a gift and has been a problem ever since.' : `Nobody hunts this ${word}. The last man who tried is the reason.`;
      }
      return (m.who = { name, title, now: () => now, life });
    }

    // --- People ---
    const female = kind === 'woman' || kind === 'woman2' || kind === 'dancer' || kind === 'girl' || kind === 'elder_woman';
    const child = kind === 'boy' || kind === 'girl', aged = kind === 'elder' || kind === 'elder_woman';
    let first = pick(female ? WOMEN : MEN);
    if (lead && lead.first === first) first = (female ? WOMEN : MEN)[((female ? WOMEN : MEN).indexOf(first) + 7) % 36]; // not the same name as whoever they are with
    const parent = pick(MEN);
    const age = child ? 6 + Math.floor(r() * 8) : aged ? 63 + Math.floor(r() * 22) : 17 + Math.floor(r() * 46);
    let trade, habit, goods = null;
    if (child) [trade, habit] = [female ? 'Girl' : 'Boy', pick(YOUNG)];
    else if (aged) [trade, habit] = [`Once a ${pick(female ? TRADES_F : TRADES_M)[0].toLowerCase()}`, pick(OLD)];
    else if (kind === 'man' || kind === 'man2' || kind === 'woman' || kind === 'woman2') [trade, habit] = pick(female ? TRADES_F : TRADES_M);
    else if (kind === 'farmer' || kind === 'farmer_work') [trade, habit] = ['Farmer', `{He} works ${pick(['nine', 'twelve', 'fifteen', 'six'])} strips of ${pick(CROPS)} and a row of olives older than the town.`];
    else if (kind === 'shepherd') [trade, habit] = [pick(['Shepherd', 'Goatherd']), '{He} spends the summer on the high pastures and comes down in autumn smelling of thyme and smoke.'];
    else if (kind === 'hoplite') [trade, habit] = ['Hoplite', `{He} carries a shield that was {his} father's, ${pick(['with a new strap', 'dented at Tegea', 'repainted every spring'])}.`];
    else if (kind === 'archer') [trade, habit] = ['Archer', '{He} learned to shoot on Crete and thinks spears are for people who like standing close.'];
    else if (kind === 'priest') [trade, habit] = ['Priest', `{He} reads the liver of every sacrifice and has learned to find good news in most of them.`];
    else if (kind === 'merchant') { goods = pick(GOODS); [trade, habit] = ['Merchant', `{He} deals in ${goods} and in news, and the news is usually worth more.`]; }
    else if (kind === 'runner') [trade, habit] = ['Runner', '{He} can cover the ground between two cities between sunrise and noon, and has, for pay.'];
    else if (kind === 'bard') [trade, habit] = ['Rhapsode', '{He} knows eleven thousand lines by heart and forgets where {he} left {his} sandals.'];
    else if (kind === 'rider') [trade, habit] = ['Courier', '{He} rides for whoever is paying and reads none of the letters.'];
    else if (kind === 'oxcart') [trade, habit] = ['Carter', '{He} has spent more of {his} life looking at the back of an ox than at any person.'];
    else if (kind === 'chariot') [trade, habit] = ['Charioteer', '{He} has turned the post at full gallop more times than {he} can count and been thrown at it twice.'];
    else if (kind === 'skiff' || kind === 'skiff2') [trade, habit] = ['Fisherman', '{He} fishes with {his} brother, who rows, and who would like it noted that he does all the rowing.'];
    else [trade, habit] = ['Traveller', '{He} has walked further than most people here will ever go.'];

    // On the road, home is whichever end of it is a town; failing that, the country round about.
    const ends = c.where === 'road' ? [c.from, c.to].filter((id) => isTown(id)) : [];
    const homeId = c.where === 'road' ? (ends.length ? ends[Math.floor(r() * ends.length)] : null) : c.town;
    const title = c.where === 'road' && !homeId ? `${trade} from the country near ${place(c.to)}, ${age}` : `${trade} of ${homeId ? place(homeId) : 'these parts'}, ${age}`;
    const local = LOCAL[homeId] || null;
    const kin = child ? KIN_CHILD : r() < 0.4 ? KIN : age < 27 ? KIN_YOUNG : KIN_GROWN;
    const life = [
      `${first}, ${female ? 'daughter' : 'son'} of ${parent}. ${say(pick(kin), female)}`,
      say(habit, female),
      say(local && r() < 0.8 ? pick(local) : pick(ANYWHERE), female),
      say(child ? pick(['{He} would like a dog.', '{He} has never seen the sea from a ship and means to.', '{He} is quite sure there is a monster in the cistern.', '{He} is hoping nobody counts the figs.']) : pick(HOPES), female),
    ];

    // What they are doing, which depends on where their path lies and who they are with.
    let doing;
    const to = place(c.to), from = place(c.from), he = female ? 'she' : 'he', his = female ? 'her' : 'his';
    if (c.where === 'company') {
      // One of a company in close order, drilling on the road before the fleet gathers (life.js).
      const nth = ['front', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][c.rank] || 'middle';
      doing = c.rank === 0 ? `Front rank of ${c.n}, drilling on the road between ${from} and ${to}. At each end they turn about, and ${he} becomes the rear rank.`
        : c.rank === c.ranks - 1 ? `Rear rank of ${c.n}, drilling on the road between ${from} and ${to}, and eating dust until the next about-turn.`
          : `${cap(nth)} rank of ${c.ranks}, drilling on the road between ${from} and ${to}. ${cap(he)} can see one helmet and has been looking at it all morning.`;
    } else if (c.role === 'spouse' && lead) doing = `Walking to ${to} with ${his} husband ${lead.first}, and setting the pace.`;
    else if (c.role === 'file' && lead) doing = c.where === 'wall' ? `On watch, a step behind ${lead.first}, walking the wall of ${town}.` : `Marching to ${to} behind ${lead.first}, thinking about supper.`;
    else if (c.role === 'plough') doing = `Ploughing behind the ox outside ${town}, and talking to it.`;
    else if (c.role === 'keeper') doing = `Minding ${c.n || 'some'} animals on the hillside and trying to keep count.`;
    else if (c.where === 'road') {
      doing = kind === 'merchant' ? `Leading a donkey loaded with ${goods} from ${from} to ${to}.`
        : kind === 'oxcart' ? `Hauling ${pick(LOADS)} to ${to}, at the speed of an ox.`
          : kind === 'rider' ? `Carrying a letter from ${from} to ${to}, and not stopping to talk.`
            : kind === 'runner' ? `Running to ${to} with news that will be old by the time it arrives.`
              : kind === 'hoplite' ? `Leading a file of men from ${from} to the garrison at ${to}.`
                : kind === 'priest' ? `Walking to ${to} to see to a sacrifice.`
                  : kind === 'bard' ? `On the way to ${to}, where someone will pay to hear the anger of Achilles again.`
                    : kind === 'shepherd' ? `Moving the flock along the road towards ${to} before the grass here gives out.`
                      : kind === 'farmer' ? `Taking ${pick(PRODUCE)} to sell in ${to}.`
                        : kind === 'chariot' ? `Driving to ${to} faster than the road was built for.`
                          : `Walking from ${from} to ${to} ${pick(REASONS)}.`;
    } else if (c.where === 'market') doing = `In the market at ${town}, ${pick(HAGGLE)}.`;
    else if (c.where === 'wall') doing = `On watch, walking the wall of ${town}. ${cap(pick(['three', 'five', 'seven', 'eleven']))} more rounds before ${he} is relieved.`;
    else if (c.where === 'field') doing = `Hoeing between the ${pick(CROPS)} outside ${town}.`;
    else if (c.where === 'boat') doing = `Fishing off ${town}. The nets come up at dusk.`;
    else if (c.where === 'sea') doing = 'Fishing in open water, a long row from anywhere.';
    else if (c.where === 'myth') doing = kind === 'runner' ? 'Running the length of the stadium, again, with the others.' : kind === 'hoplite' ? 'Drilling in the square: left turn, right turn, lock shields.' : kind === 'bard' ? 'Singing to anyone who will stop.' : 'About their own business.';
    else if (child) doing = `Out in ${town || 'the street'}, ${pick(['running an errand the long way round', 'chasing a hoop', 'late for a lesson', 'following the soldiers at a safe distance', 'carrying a message and trying to remember it'])}.`;
    else if (aged) doing = `Out in ${town || 'the street'}, ${pick(['taking the air, slowly', 'on the way to the bench by the fountain', 'going to see what the mason is doing wrong', 'looking for someone to tell about the old days'])}.`;
    else doing = `Out in ${town || 'the street'} ${pick(ERRANDS)}.`;
    const night = c.where === 'company' ? `A night march with the company, between ${from} and ${to}, keeping step by the sound of it.` : c.where === 'wall' ? `On the night watch, walking the wall of ${town} with a torch.` : c.where === 'sea' || c.where === 'boat' ? 'Night fishing, with a lamp in the bow to bring the fish up.' : 'Out late, and walking a little faster for it.';
    const dusk = `Heading home before the lamps are lit. Earlier: ${doing[0].toLowerCase()}${doing.slice(1)}`;
    return (m.who = {
      name: first, first, goods, title, life: life.join(' '),
      // night: 0 day .. 1 night. indoors: this one has gone home.
      now: (dark = 0, indoors = false) => (indoors ? 'Indoors for the night. Back at first light.' : dark > 0.85 ? night : dark > 0.45 && m.home ? dusk : doing),
    });
  }
  return who;
}
