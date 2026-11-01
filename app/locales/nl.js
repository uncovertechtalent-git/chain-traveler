// Nederlands. Same keys as en.js.
export default {
  // ---- header, status, language
  'lang.label': 'Taal',
  'meta.sub': 'Schakel de eerstvolgende regionale treinen tussen twee Duitse stations aan elkaar met het Deutschlandticket, met een tussenstop waar je maar wilt. Geplande tijden, offline gelezen uit de dienstregeling op dit apparaat.',
  'status.loading': 'Dienstregeling laden...',
  'status.first': 'Dienstregeling voor het eerst laden (ca. 5 MB)...',
  'status.loadFailed': 'De dienstregeling kon niet worden geladen ({message}). De eerste keer is een internetverbinding nodig.',
  'status.noCache': 'Deze browser kan de dienstregeling niet op het apparaat bewaren (Cache Storage via HTTPS is nodig). Probeer een actuele browser.',
  'status.readFailed': 'De opgeslagen dienstregeling kon niet worden gelezen: {message}',
  'btn.retry': 'Opnieuw proberen',

  // ---- age of the timetable
  'age.expired': 'De dienstregeling liep tot {last}. Treinen na die datum staan er niet in; maak verbinding met internet om bij te werken.',
  'age.soon': 'Dienstregeling van {date}, geldig t/m {last} ({left}). Wordt automatisch bijgewerkt als je online bent.',
  'age.lastDay': 'laatste dag',
  'age.moreDays': { one: 'nog {n} dag', other: 'nog {n} dagen' },
  'age.ok': 'Dienstregeling van {date}, geldig t/m {last}.',
  'age.offline': 'Offline: de dienstregeling op dit apparaat wordt gebruikt.',
  'age.updated': 'Zojuist bijgewerkt.',
  'age.upToDate': 'Up-to-date.',
  'age.checkFailed': 'Controleren op een nieuwere dienstregeling is mislukt ({code}); de gegevens op dit apparaat zijn ongewijzigd.',

  // ---- the trip form
  'aria.trip': 'Reis',
  'field.station': 'Station',
  'field.start': 'Van',
  'field.date': 'Datum',
  'field.leaveAfter': 'Vertrek vanaf',
  'field.target': 'Naar',
  'field.via': 'Tussenstop (optioneel)',
  'field.stay': 'Minimaal verblijf (min)',
  'field.change': 'Minimale overstaptijd (min)',
  'btn.plan': 'Keten plannen',
  'btn.swap': 'Van en naar omwisselen',
  'btn.clearvia': 'Geen tussenstop',

  // ---- tabs
  'tab.chain': 'Keten',
  'tab.reach': 'Kaart',
  'tab.deps': 'Vertrek',
  'tab.live': 'Plan B',

  // ---- chain
  'chain.intro': 'Kies een vertrek- en een aankomststation om de eerstvolgende regionale treinen ertussen aan elkaar te schakelen.',
  'chain.pickBoth': 'Kies een vertrek- en een aankomststation uit de suggesties.',
  'chain.noTrainToday': 'Geen bruikbare trein vanaf {from} op {day} na {time}. De eerste keten vertrekt op {first}.',
  'chain.timeRange': '{dep} tot {arr}',
  'leg.fromTo': '{from} naar {to}',
  'chain.onTheWay': 'onderweg',
  'chain.changes': { one: 'overstap', other: 'overstappen' },
  'chain.changesStop': { one: 'overstap plus de tussenstop', other: 'overstappen plus de tussenstop' },
  'chain.stay': 'Tussenstop in {station}: aankomst {arr}, vertrek {dep} ({dur})',
  'chain.wait': '{min} wachten in {station}',
  'chain.waitTight': '{min} wachten in {station} (krappe overstap)',
  'chain.walk': 'Loop van {from} naar {to}',
  'leg.towards': 'richting {term}, {dur}',
  'btn.out': 'Valt deze trein uit?',
  'chain.nextTrains': 'Volgende treinen bij elke halte',
  'chain.arrive': '(aankomst {time})',
  'dep.towards': 'richting {term}',
  'dep.nextStop': 'volgende halte {stop}',

  // ---- reach map
  'reach.within': 'Toon stations die je binnen {hours} u na vertrek bereikt',
  'reach.sooner': 'eerder',
  'reach.later': 'later',
  'reach.note': 'Elke stip is een station dat je met regionale treinen kunt bereiken. De kleur toont hoe snel je er vanaf het vertrekstation kunt zijn. Klik op een stip om er een keten naartoe te plannen.',

  // ---- departures
  'field.after': 'Vanaf',
  'deps.pick': 'Kies een station.',
  'deps.none': 'Geen treinen na dat tijdstip.',
  'deps.th.departs': 'Vertrek',
  'deps.th.line': 'Lijn',
  'deps.th.towards': 'Richting',
  'deps.th.next': 'Volgende halte',

  // ---- Plan B
  'live.intro': 'Valt je trein uit? Geef aan waar je bent en waar je heen gaat. Je krijgt de opties om verder te komen, elk afgezet tegen je plan, en hoeveel treinen per uur er op elk traject rijden.',
  'field.iAmAt': 'Ik ben bij',
  'field.timeNow': 'Tijd nu',
  'field.goingTo': 'Ik ga naar',
  'field.plannedArr': 'Geplande aankomst (optioneel)',
  'btn.locate': 'Gebruik mijn locatie',
  'live.say': 'Geef aan waar je bent en waar je heen gaat.',
  'live.depsTitle': 'Treinen vanaf {station} na {time}',
  'live.noMoreToday': 'Volgens de dienstregeling vertrekt er op deze datum na {time} geen trein meer uit {station}. Dit zijn de treinen van de volgende dag (+1).',
  'live.tick': 'Vink de treinen aan die uitvallen.',
  'live.unlisted': { one: 'Nog {n} trein eerder als uitgevallen aangemerkt, niet in deze lijst.', other: 'Nog {n} treinen eerder als uitgevallen aangemerkt, niet in deze lijst.' },
  'live.leadPlan': 'Aankomst volgens je plan: {plan}. Beste optie om verder te komen: aankomst {best}{later}.',
  'live.later': ', {dur} later',
  'live.leadBest': 'Geen geplande aankomst opgegeven, dus de beste optie (aankomst {best}) is de maatstaf.',
  'graph.label': 'Opties van {from} naar {to}',

  // ---- Plan B: how a way compares
  'chip.best': 'beste optie',
  'chip.best.good': 'dicht bij de beste, +{dur}',
  'chip.best.mid': 'later, +{dur}',
  'chip.best.bad': 'veel later, +{dur}',
  'chip.plan.early': 'op schema, {dur} eerder',
  'chip.plan.exact': 'op schema',
  'chip.plan.good': 'op schema, +{dur}',
  'chip.plan.mid': 'laat, +{dur}',
  'chip.plan.bad': 'veel later, +{dur}',
  'tag.earliest': 'Vroegste aankomst',
  'tag.fewest': 'Minste overstappen',
  'tag.robust': 'Meeste treinen per uur',
  'opt.arrive': 'aankomst',
  'opt.leave': 'vertrek {time}',
  'opt.changes': { one: '{n} overstap', other: '{n} overstappen' },
  'opt.tightest': 'krapste overstap {min}',
  'opt.thinnest': { one: 'minst frequente traject: {n} trein per uur', other: 'minst frequente traject: {n} treinen per uur' },

  // ---- Plan B: legend. green, amber and red are the colours of the chips and lines
  'legend.green': 'groen',
  'legend.amber': 'oranje',
  'legend.red': 'rood',
  'legend.basePlan': 'je plan',
  'legend.baseBest': 'de beste optie',
  'legend.good': 'tot {n} min na {base}',
  'legend.mid': 'tot {n} min',
  'legend.bad': 'daarboven.',
  'legend.thick': 'Lijndikte: treinen per uur op dat traject, van één (dun) tot vier of meer (dik).',
  'legend.dotted': 'De stippellijn: het plan dat je had.',

  // ---- Plan B: where you are
  'loc.looking': 'Je positie wordt bepaald...',
  'loc.unsupported': 'Deze browser kan je locatie niet bepalen. Kies het station op naam.',
  'loc.denied': 'Locatie is niet toegestaan voor deze pagina. Sta het toe voor deze site in de browserinstellingen, of kies het station op naam.',
  'loc.unavailable': 'Het apparaat kon je locatie niet bepalen. Kies het station op naam.',
  'loc.timeout': 'Je positie bepalen duurde te lang. Probeer opnieuw of kies het station op naam.',
  'loc.none': 'Geen station met regionale treinen binnen 40 km van je. Kies het station op naam.',
  'loc.near': 'Je bent in de buurt van {station} ({dist}). Datum en tijd zijn ingesteld op nu.',
  'loc.rough': 'De positie is maar tot ongeveer {km} km nauwkeurig, controleer dus het station.',
  'loc.private': 'Je positie blijft op dit apparaat.',
  'loc.notHere': 'Niet hier?',

  // ---- search errors
  'err.sameStation': 'Vertrek en bestemming zijn hetzelfde station.',
  'err.viaUnreachable': 'De tussenstop is na de vertrektijd niet te bereiken.',
  'err.noOnward': 'Geen aansluiting na het verblijf; probeer een korter verblijf of een eerder vertrek.',
  'err.noConnection': 'Die dag is er na de vertrektijd geen verbinding.',
  'err.alreadyThere': 'Je bent al op de bestemming.',
  'err.noWay': 'Vanaf hier is er na dat tijdstip geen manier meer om de bestemming te bereiken.',

  // ---- footer
  'foot': 'Dienstregeling: {publisher}, {license}. {stations} stations, {connections} verbindingen, {first} tot {last}. Alleen geplande tijden, geen vertragingen of werkzaamheden. Controleer je reis in DB Navigator voordat je vertrekt.',

  // ---- units. {n} is a number
  'unit.h': 'u',
  'unit.min': 'min',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.perHour': '{n}/u',

  // ---- the page for an address that does not exist
  'nf.title': 'Niet gevonden',
  'nf.body': 'Op dit adres staat geen pagina. {app} plant ketens van regionale treinen met het Deutschlandticket, offline.',
};
