// The gazetteer: every named place on the map.
//
//   kind   gods | heroes | monsters | odyssey   (sets the label colour and the atlas group)
//   tier   1 = always labelled, 2 = labelled at normal zoom, 3 = only when zoomed in
//   model  which landmark to build there (see landmarks.js); omitted = label only
//   flat   radius of ground levelled for the landmark, in hexes
//   peak   put the landmark on the highest ground nearby instead of the exact spot
//   raise  create ground if the data has sea there
//
// Where the ancient world argued about a location (most of the Odyssey), the map
// follows the most widely repeated tradition and says so in the text.

export const KINDS = {
  gods: { label: 'Gods & Titans' },
  heroes: { label: 'Heroes & Kings' },
  monsters: { label: 'Monsters' },
  odyssey: { label: 'The Odyssey' },
};

export const SITES = [
  // ---------------------------------------------------------------- gods ----
  {
    id: 'olympus', name: 'Mount Olympus', greek: 'Ὄλυμπος', kind: 'gods', tier: 1, lon: 22.35, lat: 40.085,
    model: 'olympus', flat: 1.1, peak: true,
    text: 'The highest peak in Greece and the seat of the twelve Olympian gods. Zeus holds court above the clouds and settles arguments with thunderbolts. Watch the summit for a while.',
  },
  {
    id: 'delphi', name: 'Delphi', greek: 'Δελφοί', kind: 'gods', tier: 1, lon: 22.501, lat: 38.482,
    model: 'delphi', flat: 1.3,
    text: 'Zeus loosed two eagles from the ends of the earth and they met here, at the navel of the world. Apollo killed the serpent Python on this slope, and his priestess, the Pythia, breathes the vapours rising from the rock and speaks in riddles.',
  },
  {
    id: 'delos', name: 'Delos', greek: 'Δῆλος', kind: 'gods', tier: 2, lon: 25.27, lat: 37.4,
    model: 'delos', flat: 0.6,
    text: 'A drifting rock until Leto, hunted by jealous Hera, clung to its palm tree and gave birth to Apollo and Artemis. Zeus then chained the island to the sea floor. The Cyclades are named for the circle they form around it.',
  },
  {
    id: 'lemnos', name: 'Lemnos', greek: 'Λῆμνος', kind: 'gods', tier: 2, lon: 25.2, lat: 39.9,
    model: 'forge', flat: 1.0,
    text: 'When Hephaestus was thrown from Olympus he fell for a whole day and landed here. The islanders nursed him, and he set up his forge on the island. The smoke you see is the smith god at work.',
  },
  {
    id: 'kythera', name: 'Kythera', greek: 'Κύθηρα', kind: 'gods', tier: 2, lon: 23.08, lat: 36.2,
    model: 'aphrodite', sea: true,
    text: 'Aphrodite rose from the sea foam and, by Hesiod\'s telling, drifted first past Kythera on her way to Cyprus. Flowers grew wherever she stepped ashore.',
  },
  {
    id: 'dodona', name: 'Dodona', greek: 'Δωδώνη', kind: 'gods', tier: 2, lon: 20.79, lat: 39.546,
    model: 'dodona', flat: 1.1,
    text: 'The oldest oracle in Greece. Barefoot priests read the will of Zeus in the rustling of a sacred oak and the ringing of bronze cauldrons hung around it. A beam cut from this oak was built into the prow of the Argo and could speak.',
  },
  {
    id: 'sounion', name: 'Cape Sounion', greek: 'Σούνιον', kind: 'gods', tier: 2, lon: 24.025, lat: 37.66,
    model: 'sounion', flat: 0.8,
    text: 'Poseidon\'s temple stands on the last cliff of Attica. From here King Aegeus watched for his son Theseus, saw black sails instead of white, and threw himself into the sea that still carries his name.',
  },
  {
    id: 'ida', name: 'Mount Ida', greek: 'Ἴδη', kind: 'gods', tier: 2, lon: 24.77, lat: 35.226,
    model: 'cave', flat: 0.9, peak: true,
    text: 'Rhea hid the infant Zeus in a cave on this mountain so that his father Cronus would not swallow him. The goat Amalthea nursed him, and the Kouretes clashed their shields to drown out his crying.',
  },
  {
    id: 'etna', name: 'Mount Etna', greek: 'Αἴτνη', kind: 'gods', tier: 1, lon: 14.995, lat: 37.751,
    model: 'etna', flat: 0.9, peak: true,
    text: 'Zeus ended his war with the hundred-headed Typhon by dropping this mountain on him. The monster still thrashes underneath, which is why Etna smokes. Hephaestus and the Cyclopes are said to keep a second forge in its roots.',
  },
  {
    id: 'othrys', name: 'Mount Othrys', greek: 'Ὄθρυς', kind: 'gods', tier: 3, lon: 22.7, lat: 39.02,
    model: 'othrys', flat: 0.9, peak: true,
    text: 'The stronghold of Cronus and the Titans. For ten years they fought the young Olympians across the plain of Thessaly, mountain against mountain, until Zeus freed the Cyclopes and the Hundred-Handers and won.',
  },
  {
    id: 'ephesus', name: 'Ephesus', greek: 'Ἔφεσος', kind: 'gods', tier: 2, lon: 27.341, lat: 37.94,
    model: 'artemision', flat: 1.7,
    text: 'Home of the great temple of Artemis, said to have been founded by the Amazons. It grew into one of the seven wonders of the world.',
  },
  {
    id: 'enna', name: 'Enna', greek: 'Ἔννα', kind: 'gods', tier: 2, lon: 14.28, lat: 37.57,
    model: 'meadow', flat: 1.3,
    text: 'Persephone was picking flowers in this meadow when the ground split open and Hades carried her down to the underworld. Her mother Demeter searched the earth for her and let nothing grow, which was the first winter.',
  },
  {
    id: 'naxos', name: 'Naxos', greek: 'Νάξος', kind: 'gods', tier: 2, lon: 25.42, lat: 37.09,
    model: 'naxos', flat: 1.0,
    text: 'Theseus abandoned Ariadne on this shore after she helped him out of the Labyrinth. Dionysus found her here and married her, and set her crown among the stars.',
  },
  {
    id: 'tainaron', name: 'Cape Tainaron', greek: 'Ταίναρον', kind: 'gods', tier: 2, lon: 22.46, lat: 36.43,
    model: 'hadesgate', flat: 0.9,
    text: 'A cave at the southern tip of the mainland was believed to be a back door to the underworld. Orpheus went down here to plead for Eurydice, and Heracles came up the same way dragging Cerberus, the three-headed hound of Hades.',
  },
  {
    id: 'hesperides', name: 'Garden of the Hesperides', greek: 'Ἑσπερίδες', kind: 'gods', tier: 2, lon: 21.75, lat: 32.74,
    model: 'hesperides', flat: 1.3,
    text: 'Hera\'s orchard of golden apples, tended by the nymphs of the evening and guarded by the dragon Ladon. Most writers put it at the far edge of the world; the Greeks who settled Cyrenaica claimed it for this green hillside in Libya.',
  },
  {
    id: 'arcadia', name: 'Arcadia', greek: 'Ἀρκαδία', kind: 'gods', tier: 3, lon: 22.12, lat: 37.52,
    model: 'pan', flat: 1.0,
    text: 'The high pastures of the Peloponnese belong to Pan, the goat-legged god of shepherds. He invented the reed pipes here. A shout from him at noon is the original panic.',
  },
  {
    id: 'pactolus', name: 'River Pactolus', greek: 'Πακτωλός', kind: 'gods', tier: 3, lon: 27.95, lat: 38.6,
    model: 'midas', flat: 1.2,
    text: 'King Midas asked Dionysus that everything he touched turn to gold, and soon could not eat. The god told him to wash in this river. The curse passed into the water, which is why its sands carried gold.',
  },

  // -------------------------------------------------------------- heroes ----
  {
    id: 'athens', name: 'Athens', greek: 'Ἀθῆναι', kind: 'heroes', tier: 1, lon: 23.727, lat: 37.972,
    model: 'athens', flat: 1.9,
    text: 'Athena and Poseidon competed to be patron of the city. He struck the Acropolis and a salt spring came up; she planted the first olive tree and won. Theseus, who killed the Minotaur, was its king.',
  },
  {
    id: 'mycenae', name: 'Mycenae', greek: 'Μυκῆναι', kind: 'heroes', tier: 2, lon: 22.756, lat: 37.731,
    model: 'mycenae', flat: 1.2,
    text: 'The citadel of Agamemnon, who led the Greeks to Troy. Its walls are so massive that later Greeks believed the Cyclopes built them. Agamemnon came home through the Lion Gate after ten years and was murdered in his bath.',
  },
  {
    id: 'sparta', name: 'Sparta', greek: 'Σπάρτη', kind: 'heroes', tier: 1, lon: 22.43, lat: 37.075,
    model: 'sparta', flat: 1.4,
    text: 'The palace of Menelaus and Helen. Paris of Troy came as a guest and left with the queen, and a thousand ships sailed to bring her back. Telemachus visits here in the Odyssey looking for news of his father.',
  },
  {
    id: 'corinth', name: 'Corinth', greek: 'Κόρινθος', kind: 'heroes', tier: 2, lon: 22.88, lat: 37.9,
    model: 'sisyphus', flat: 1.2,
    text: 'Its founder Sisyphus cheated death twice. His punishment is to push a boulder up a hill forever; each time he nears the top it rolls back down. Bellerophon caught the winged horse Pegasus at the spring here.',
  },
  {
    id: 'thebes', name: 'Thebes', greek: 'Θῆβαι', kind: 'heroes', tier: 2, lon: 23.32, lat: 38.32,
    model: 'thebes', flat: 1.4,
    text: 'Cadmus founded the city by sowing dragon\'s teeth. Later a Sphinx sat outside the gates and ate everyone who failed her riddle, until Oedipus answered it. Heracles and Dionysus were both born here.',
  },
  {
    id: 'olympia', name: 'Olympia', greek: 'Ὀλυμπία', kind: 'heroes', tier: 2, lon: 21.63, lat: 37.638,
    model: 'olympia', flat: 1.4,
    text: 'Pelops won his bride in a chariot race here, and Heracles paced out the first stadium. The games held every four years in honour of Zeus stopped wars across Greece.',
  },
  {
    id: 'nemea', name: 'Nemea', greek: 'Νεμέα', kind: 'monsters', tier: 3, lon: 22.58, lat: 37.83,
    model: 'lion', flat: 0.8,
    text: 'The first labour of Heracles. The Nemean lion had a hide no blade could cut, so he strangled it and wore the skin as armour for the rest of his life.',
  },
  {
    id: 'lerna', name: 'Lerna', greek: 'Λέρνη', kind: 'monsters', tier: 2, lon: 22.74, lat: 37.52,
    model: 'hydra', flat: 0.7,
    text: 'The second labour of Heracles. The Hydra lived in this swamp and grew two heads for each one cut off. His nephew Iolaus seared the necks with a torch before they could sprout.',
  },
  {
    id: 'stymphalia', name: 'Lake Stymphalia', greek: 'Στύμφαλος', kind: 'monsters', tier: 3, lon: 22.36, lat: 37.9,
    model: 'birds', flat: 0.8,
    text: 'The sixth labour of Heracles. The marsh was thick with man-eating birds that had bronze beaks and shot their feathers like arrows. He scared them into the air with a rattle and shot them down.',
  },
  {
    id: 'pylos', name: 'Pylos', greek: 'Πύλος', kind: 'heroes', tier: 3, lon: 21.7, lat: 37.03,
    model: 'megaron', flat: 1.0,
    text: 'Sandy Pylos, kingdom of wise old Nestor, who fought at Troy in his third generation of men. Telemachus lands here first when he sets out to find his father.',
  },
  {
    id: 'iolcos', name: 'Iolcos', greek: 'Ἰωλκός', kind: 'heroes', tier: 2, lon: 22.92, lat: 39.34,
    model: 'harbor', flat: 0.9,
    text: 'Jason was sent from this harbour to fetch the Golden Fleece from Colchis, at the far end of the Black Sea. He launched the Argo here with a crew of fifty heroes. Watch for her sail heading for the Hellespont.',
  },
  {
    id: 'pelion', name: 'Mount Pelion', greek: 'Πήλιον', kind: 'heroes', tier: 3, lon: 23.14, lat: 39.4,
    model: 'chiron', flat: 0.8,
    text: 'Home of the centaurs. The wisest of them, Chiron, kept a cave here and brought up Jason, Asclepius and Achilles, teaching them medicine, music and the bow.',
  },
  {
    id: 'troy', name: 'Troy', greek: 'Τροία', kind: 'heroes', tier: 1, lon: 26.239, lat: 39.957,
    model: 'troy', flat: 2.1,
    text: 'For ten years the Greeks camped on this plain and could not break the walls. Then Odysseus had a hollow wooden horse built and left on the beach as a gift. The Trojans dragged it inside. The Odyssey begins the morning after.',
  },
  {
    id: 'hellespont', name: 'Hellespont', greek: 'Ἑλλήσποντος', kind: 'heroes', tier: 3, lon: 26.52, lat: 40.3,
    text: 'The strait between Europe and Asia. It is named for Helle, who fell into it from the back of the flying golden ram. The ram\'s fleece is what Jason sailed through here to find.',
  },
  {
    id: 'symplegades', name: 'Clashing Rocks', greek: 'Συμπληγάδες', kind: 'monsters', tier: 2, lon: 29.14, lat: 41.33,
    model: 'symplegades', sea: true,
    text: 'Two cliffs at the mouth of the Black Sea that slammed together on anything passing between them. Jason sent a dove through first; it lost only its tail feathers, and the Argo rowed after it and lost only her stern ornament.',
  },
  {
    id: 'rhodes', name: 'Rhodes', greek: 'Ῥόδος', kind: 'heroes', tier: 1, lon: 28.225, lat: 36.445,
    model: 'colossus', flat: 1.0,
    text: 'The island Helios, the sun, chose for himself when the gods divided the world. The Rhodians later raised a bronze statue of him more than thirty metres tall beside their harbour, one of the seven wonders.',
  },
  {
    id: 'knossos', name: 'Knossos', greek: 'Κνωσός', kind: 'monsters', tier: 1, lon: 25.163, lat: 35.298,
    model: 'labyrinth', flat: 1.9,
    text: 'King Minos had Daedalus build a maze under his palace to hold the Minotaur, half man and half bull, and fed it with young Athenians. Theseus killed it and found his way out by following a thread Ariadne gave him.',
  },
  {
    id: 'icaria', name: 'Icarian Sea', greek: 'Ἰκάριον πέλαγος', kind: 'heroes', tier: 2, lon: 26.05, lat: 37.34,
    sea: true,
    text: 'Daedalus built wings of feathers and wax to escape Crete with his son Icarus, and told him not to fly too high. Icarus climbed toward the sun, the wax melted, and he fell into this stretch of sea. Look up.',
  },
  {
    id: 'lycia', name: 'Lycia', greek: 'Λυκία', kind: 'monsters', tier: 2, lon: 30.38, lat: 36.48,
    model: 'chimera', flat: 0.9,
    text: 'Country of the Chimera: a lion in front, a goat in the middle and a snake behind, breathing fire. Bellerophon killed her from the air, riding Pegasus. Flames still burn out of the rock on this mountainside.',
  },
  {
    id: 'gorgons', name: 'Lair of the Gorgons', greek: 'Γοργόνες', kind: 'monsters', tier: 2, lon: 12.95, lat: 32.74,
    model: 'medusa', flat: 1.1,
    text: 'Medusa and her sisters had snakes for hair and turned anyone who met their eyes to stone. Perseus cut off her head while looking only at her reflection in his shield. Later writers placed the Gorgons in Libya.',
  },
  {
    id: 'thrace', name: 'Thrace', greek: 'Θρᾴκη', kind: 'heroes', tier: 3, lon: 24.75, lat: 41.2,
    model: 'orpheus', flat: 0.9,
    text: 'The country of Orpheus, whose singing made trees and wild animals follow him and rivers stop to listen. He sailed with the Argonauts and went down to the underworld for his wife Eurydice.',
  },
  {
    id: 'chios', name: 'Chios', greek: 'Χίος', kind: 'heroes', tier: 3, lon: 26.08, lat: 38.4,
    model: 'homer', flat: 0.7,
    text: 'Seven cities claimed to be the birthplace of Homer. Chios had the strongest case and a guild of singers, the Homeridae, who called themselves his descendants. Everything on this map was first sung by someone like him.',
  },

  // ------------------------------------------------------------- odyssey ----
  {
    id: 'ismarus', name: 'Ismarus', greek: 'Ἴσμαρος', kind: 'odyssey', tier: 2, lon: 25.51, lat: 40.87,
    model: 'ismarus', flat: 1.1,
    text: 'City of the Cicones. Odysseus raided it straight after leaving Troy. His men stayed on the beach drinking, the Cicones came back with their neighbours, and he lost six men from every ship.',
  },
  {
    id: 'malea', name: 'Cape Malea', greek: 'Μαλέας', kind: 'odyssey', tier: 2, lon: 23.2, lat: 36.4,
    model: 'storm', sea: true,
    text: 'The last corner before home, and a graveyard of ships. A north wind caught the fleet as it rounded the cape and drove it for nine days, off the edge of the known world.',
  },
  {
    id: 'lotus', name: 'Land of the Lotus-Eaters', greek: 'Λωτοφάγοι', kind: 'odyssey', tier: 1, lon: 10.86, lat: 33.8,
    model: 'lotus', flat: 1.2,
    text: 'The people here live on a honey-sweet fruit. Sailors who tasted it forgot their homes and wanted only to stay. Odysseus dragged his scouts back to the ships in tears and tied them under the benches. Tradition puts it on Djerba.',
  },
  {
    id: 'cyclops', name: 'Cave of the Cyclops', greek: 'Κύκλωψ', kind: 'odyssey', tier: 1, lon: 15.1, lat: 37.44,
    model: 'cyclops', flat: 1.5,
    text: 'The one-eyed giant Polyphemus trapped Odysseus in his cave and began eating the crew. Odysseus told him his name was Nobody, got him drunk, and blinded him with a sharpened stake. They escaped clinging under his sheep. Polyphemus hurled rocks after the ship and called on his father Poseidon for revenge.',
  },
  {
    id: 'aeolia', name: 'Aeolia', greek: 'Αἰολία', kind: 'odyssey', tier: 2, lon: 14.5, lat: 38.78,
    model: 'aeolia', sea: true,
    text: 'A floating island ringed with a wall of bronze, home of Aeolus, keeper of the winds. He gave Odysseus every contrary wind tied up in an oxhide bag. Within sight of Ithaca the crew opened it looking for gold, and the storm blew them all the way back.',
  },
  {
    id: 'laestrygonia', name: 'Telepylos', greek: 'Τηλέπυλος', kind: 'odyssey', tier: 2, lon: 13.6, lat: 41.27,
    model: 'giants', flat: 1.2,
    text: 'Harbour of the Laestrygonians, man-eating giants. Eleven ships moored inside the cliffs and were smashed with boulders; the crews were speared like fish. Only Odysseus, who had tied up outside, got away. The Romans placed it at Formiae.',
  },
  {
    id: 'aeaea', name: 'Aeaea', greek: 'Αἰαία', kind: 'odyssey', tier: 1, lon: 13.06, lat: 41.24,
    model: 'circe', flat: 1.3,
    text: 'Island of the witch Circe, who turned half the crew into pigs. Hermes gave Odysseus a herb, moly, that made him immune. She changed the men back, and they stayed a year. The headland of Monte Circeo is named for her.',
  },
  {
    id: 'avernus', name: 'Land of the Dead', greek: 'Νέκυια', kind: 'odyssey', tier: 2, lon: 14.07, lat: 40.86,
    model: 'underworld', flat: 1.1,
    text: 'On Circe\'s instructions Odysseus sailed to the edge of the world, dug a trench and filled it with blood to call up the dead. He spoke with the prophet Tiresias, with Achilles, and with his own mother. The Romans placed the entrance at Lake Avernus.',
  },
  {
    id: 'sirens', name: 'Rocks of the Sirens', greek: 'Σειρῆνες', kind: 'odyssey', tier: 1, lon: 14.43, lat: 40.56,
    model: 'sirens', flat: 0.55,
    text: 'The Sirens sang so sweetly that sailors steered onto the rocks to hear more. Odysseus stopped his crew\'s ears with wax and had himself tied to the mast, so he became the only man to hear the song and live.',
  },
  {
    id: 'scylla', name: 'Scylla & Charybdis', greek: 'Σκύλλα καὶ Χάρυβδις', kind: 'odyssey', tier: 1, lon: 15.66, lat: 38.26,
    model: 'scylla', sea: true,
    text: 'A strait with a monster on each side. Charybdis swallows the sea three times a day in a whirlpool; Scylla has six heads on long necks and takes one sailor with each. Odysseus chose Scylla and lost six men. Tradition puts them in the Strait of Messina.',
  },
  {
    id: 'thrinacia', name: 'Thrinacia', greek: 'Θρινακία', kind: 'odyssey', tier: 2, lon: 14.98, lat: 36.9,
    model: 'cattle', flat: 1.3,
    text: 'Pasture of the sun god\'s immortal cattle. Odysseus made the crew swear to leave them alone, but they were stranded for a month and starving, and they slaughtered the best of the herd while he slept. Zeus sank the ship with a thunderbolt. Odysseus alone survived.',
  },
  {
    id: 'ogygia', name: 'Ogygia', greek: 'Ὠγυγία', kind: 'odyssey', tier: 2, lon: 14.26, lat: 36.05,
    model: 'calypso', flat: 0.9,
    text: 'Odysseus washed up here clinging to his keel. The nymph Calypso kept him for seven years and offered to make him immortal. He spent his days on the shore looking out to sea. Tradition says Gozo.',
  },
  {
    id: 'scheria', name: 'Scheria', greek: 'Σχερία', kind: 'odyssey', tier: 2, lon: 19.86, lat: 39.62,
    model: 'scheria', flat: 1.2,
    text: 'Land of the Phaeacians, the best sailors alive. Odysseus was thrown ashore naked and found by the princess Nausicaa. At her father\'s table he finally told the story of his wanderings, and they carried him home asleep. Tradition says Corfu.',
  },
  {
    id: 'ithaca', name: 'Ithaca', greek: 'Ἰθάκη', kind: 'odyssey', tier: 1, lon: 20.69, lat: 38.4,
    model: 'ithaca', flat: 0.9,
    text: 'Home. Twenty years after he left, Odysseus came back disguised as a beggar and found his hall full of suitors pressing his wife Penelope to remarry. He strung the bow only he could string, and that was the end of them.',
  },
];

// The voyage, in order. `site` is where the ship puts in.
export const VOYAGE = [
  {
    site: 'troy', title: 'The sack of Troy', book: 'Before the poem',
    text: 'The war is over. Twelve ships from Ithaca load their share of the plunder and turn for home. It should take a few weeks.',
  },
  {
    site: 'ismarus', title: 'The Cicones', book: 'Book 9',
    text: 'A raid on the first city they pass goes well until the crew refuses to leave the beach. The Cicones return at dawn in force. Six men from each ship stay behind.',
  },
  {
    site: 'malea', title: 'Blown off the map', book: 'Book 9',
    text: 'They are rounding Cape Malea, the last turn before Ithaca, when the north wind takes them. For nine days they run before it, past Kythera and out of the world they know.',
  },
  {
    site: 'lotus', title: 'The Lotus-Eaters', book: 'Book 9',
    text: 'Friendly people offer the scouts a sweet fruit. The men who eat it forget they ever wanted to go home. Odysseus hauls them aboard and rows away before anyone else can try it.',
  },
  {
    site: 'cyclops', title: 'The Cyclops', book: 'Book 9',
    text: 'Curiosity takes Odysseus into the cave of Polyphemus. Six men are eaten before he blinds the giant and slips out under the sheep. Then he shouts his real name from the ship, and Polyphemus prays to Poseidon to curse it.',
  },
  {
    site: 'aeolia', title: 'The bag of winds', book: 'Book 10',
    text: 'Aeolus, keeper of the winds, ties every wind but the west wind into a leather bag. For nine days the fleet runs straight for home.',
  },
  {
    site: 'ithaca', near: [20.3, 38.25], title: 'Within sight of home', book: 'Book 10',
    text: 'They are close enough to see men tending fires on Ithaca. Odysseus, who has held the tiller for nine days, falls asleep. The crew opens the bag to look for treasure.',
  },
  {
    site: 'aeolia', title: 'Back where they started', book: 'Book 10',
    text: 'The storm throws them all the way back to Aeolia. Aeolus will not help a second time: a man this unlucky must be hated by the gods.',
  },
  {
    site: 'laestrygonia', title: 'The Laestrygonians', book: 'Book 10',
    text: 'Eleven ships anchor in a calm harbour between cliffs. Giants line the rim and smash them with boulders. Only the ship of Odysseus, moored outside, escapes. One ship is left of twelve.',
  },
  {
    site: 'aeaea', title: 'Circe', book: 'Book 10',
    text: 'The witch Circe turns the scouting party into pigs. Protected by a herb from Hermes, Odysseus forces her to undo it. Then they stay a year as her guests.',
  },
  {
    site: 'avernus', title: 'The Land of the Dead', book: 'Book 11',
    text: 'To learn the way home he must ask the dead. The ghost of the prophet Tiresias warns him: do not touch the cattle of the Sun. He also meets his mother, who died waiting for him.',
  },
  {
    site: 'sirens', title: 'The Sirens', book: 'Book 12',
    text: 'The crew rows with wax in their ears. Odysseus, tied to the mast, hears the song and begs to be let loose. They tie him tighter.',
  },
  {
    site: 'scylla', title: 'Scylla and Charybdis', book: 'Book 12',
    text: 'Steering wide of the whirlpool puts them under the cliff. Scylla takes six men, one for each head. He had been told this would happen and had not told the crew.',
  },
  {
    site: 'thrinacia', title: 'The cattle of the Sun', book: 'Book 12',
    text: 'Contrary winds strand them for a month. The crew kills the sacred cattle while Odysseus sleeps. When they sail, Zeus breaks the ship with lightning and everyone drowns but him.',
  },
  {
    site: 'ogygia', title: 'Calypso', book: 'Books 5 and 12',
    text: 'He drifts for nine days on the wreckage. The nymph Calypso takes him in and keeps him seven years, until Zeus sends Hermes to tell her to let him go. He builds a raft.',
  },
  {
    site: 'scheria', title: 'The Phaeacians', book: 'Books 6 to 13',
    text: 'Poseidon wrecks the raft. Odysseus swims for two days and is found on the beach by Nausicaa. At the court of her father he tells this whole story, and the Phaeacians give him a ship.',
  },
  {
    site: 'ithaca', title: 'Ithaca', book: 'Books 13 to 24',
    text: 'They set him down asleep on his own beach, twenty years after he left. One hundred and eight suitors are eating his house bare. He has a son he has never really met, a wife who is still waiting, and a bow.',
  },
];
