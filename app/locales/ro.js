// Română. The keys, placeholders and plural forms of en.js (ro: one, few, other).
// Number + noun: "few" is 0 and 2 to 19 ("2 schimbări"), "other" is 20 and up and takes "de" ("20 de schimbări").
export default {
  // ---- header, status, language
  'lang.label': 'Limbă',
  'meta.sub': 'Legați în lanț următoarele trenuri regionale dintre oricare două gări germane cu Deutschlandticket, cu o oprire oriunde doriți. Ore planificate, citite offline din orarul de pe acest dispozitiv.',
  'status.loading': 'Se încarcă orarul...',
  'status.first': 'Se încarcă orarul pentru prima dată (aproximativ 5 MB)...',
  'status.loadFailed': 'Orarul nu a putut fi încărcat ({message}). Prima pornire necesită o conexiune la internet.',
  'status.noCache': 'Acest browser nu poate păstra orarul pe dispozitiv (necesită Cache Storage prin HTTPS). Încercați un browser actual.',
  'status.readFailed': 'Orarul salvat nu a putut fi citit: {message}',
  'btn.retry': 'Încercați din nou',

  // ---- age of the timetable
  'age.expired': 'Valabilitatea orarului a expirat la {last}. Trenurile de după această dată nu sunt incluse; conectați-vă la internet pentru actualizare.',
  'age.soon': 'Orar din {date}, valabil până la {last} ({left}). Se actualizează singur când sunteți online.',
  'age.lastDay': 'ultima zi',
  'age.moreDays': { one: 'încă {n} zi', few: 'încă {n} zile', other: 'încă {n} de zile' },
  'age.ok': 'Orar din {date}, valabil până la {last}.',
  'age.offline': 'Offline: se folosește orarul de pe acest dispozitiv.',
  'age.updated': 'Actualizat chiar acum.',
  'age.upToDate': 'La zi.',
  'age.checkFailed': 'Nu s-a putut verifica dacă există un orar mai nou ({code}); datele de pe dispozitiv rămân neschimbate.',

  // ---- the trip form
  'aria.trip': 'Călătorie',
  'field.station': 'Gară',
  'field.start': 'Gara de plecare',
  'field.date': 'Data',
  'field.leaveAfter': 'Plecare după',
  'field.target': 'Gara de destinație',
  'field.via': 'Oprire (opțional)',
  'field.stay': 'Oprire minimă (min)',
  'field.change': 'Schimbare minimă (min)',
  'btn.plan': 'Planificați lanțul',
  'btn.swap': 'Inversați plecarea și destinația',
  'btn.clearvia': 'Fără oprire',

  // ---- tabs
  'tab.chain': 'Lanț',
  'tab.reach': 'Hartă destinații',
  'tab.deps': 'Plecări',
  'tab.live': 'Plan B',

  // ---- chain
  'chain.intro': 'Alegeți gara de plecare și gara de destinație pentru a lega în lanț următoarele trenuri regionale dintre ele.',
  'chain.pickBoth': 'Alegeți din sugestii gara de plecare și gara de destinație.',
  'chain.noTrainToday': 'Niciun tren utilizabil din {from}, {day}, după {time}. Primul lanț pleacă: {first}.',
  'chain.timeRange': '{dep} – {arr}',
  'leg.fromTo': '{from} – {to}',
  'chain.onTheWay': 'în călătorie',
  'chain.changes': { one: 'schimbare', few: 'schimbări', other: 'de schimbări' },
  'chain.changesStop': { one: 'schimbare plus oprirea', few: 'schimbări plus oprirea', other: 'de schimbări plus oprirea' },
  'chain.stay': 'Oprire în {station}: sosire {arr}, plecare {dep} ({dur})',
  'chain.wait': '{min} în {station}',
  'chain.waitTight': '{min} în {station} (schimbare scurtă)',
  'chain.walk': 'Pe jos de la {from} la {to}',
  'leg.towards': 'spre {term}, {dur}',
  'btn.out': 'Trenul este anulat?',
  'chain.nextTrains': 'Următoarele trenuri la fiecare oprire',
  'chain.arrive': '(sosire {time})',
  'dep.towards': 'spre {term}',
  'dep.nextStop': 'următoarea oprire {stop}',

  // ---- reach map
  'reach.within': 'Arată gările la care se ajunge în cel mult {hours} h de la plecare',
  'reach.sooner': 'mai devreme',
  'reach.later': 'mai târziu',
  'reach.note': 'Fiecare punct este o gară la care se poate ajunge cu trenul regional. Culoarea arată cât de repede puteți ajunge acolo din gara de plecare. Apăsați pe un punct pentru a crea un lanț până acolo.',

  // ---- departures
  'field.after': 'După',
  'deps.pick': 'Alegeți o gară.',
  'deps.none': 'Nu există plecări după acea oră.',
  'deps.th.departs': 'Pleacă',
  'deps.th.line': 'Linie',
  'deps.th.towards': 'Spre',
  'deps.th.next': 'Următoarea oprire',

  // ---- Plan B
  'live.intro': 'Trenul dvs. este anulat? Spuneți unde vă aflați și încotro mergeți. Primiți variantele de continuare de aici, fiecare raportată la planul dvs., și câte trenuri pe oră circulă pe fiecare tronson.',
  'field.iAmAt': 'Mă aflu la',
  'field.timeNow': 'Ora acum',
  'field.goingTo': 'Merg spre',
  'field.plannedArr': 'Sosire planificată (opțional)',
  'btn.locate': 'Folosiți locația mea',
  'live.say': 'Spuneți unde vă aflați și încotro mergeți.',
  'live.depsTitle': 'Trenuri din {station} după {time}',
  'live.noMoreToday': 'Conform orarului, în această zi nu mai pleacă niciun tren din {station} după {time}. Cele de mai jos sunt din ziua următoare (+1).',
  'live.tick': 'Bifați trenurile anulate.',
  'live.unlisted': {
    one: 'Încă {n} tren marcat mai devreme ca anulat nu apare în această listă.',
    few: 'Încă {n} trenuri marcate mai devreme ca anulate nu apar în această listă.',
    other: 'Încă {n} de trenuri marcate mai devreme ca anulate nu apar în această listă.',
  },
  'live.leadPlan': 'Planul dvs. prevedea sosirea la {plan}. Cea mai bună variantă acum ajunge la {best}{later}.',
  'live.later': ', cu {dur} mai târziu',
  'live.leadBest': 'Nu ați indicat o sosire planificată, așa că reperul este cea mai bună variantă (sosire la {best}).',
  'graph.label': 'Variante de la {from} la {to}',

  // ---- Plan B: how a way compares
  'chip.best': 'cea mai bună variantă',
  'chip.best.good': 'aproape de cea mai bună, +{dur}',
  'chip.best.mid': 'mai târziu, +{dur}',
  'chip.best.bad': 'mult mai târziu, +{dur}',
  'chip.plan.early': 'conform planului, {dur} mai devreme',
  'chip.plan.exact': 'conform planului',
  'chip.plan.good': 'conform planului, +{dur}',
  'chip.plan.mid': 'întârziat, +{dur}',
  'chip.plan.bad': 'mult mai târziu, +{dur}',
  'tag.earliest': 'Sosire cât mai devreme',
  'tag.fewest': 'Cele mai puține schimbări',
  'tag.robust': 'Cele mai multe trenuri pe oră',
  'opt.arrive': 'sosire',
  'opt.leave': 'plecare {time}',
  'opt.changes': { one: '{n} schimbare', few: '{n} schimbări', other: '{n} de schimbări' },
  'opt.tightest': 'cea mai scurtă schimbare {min}',
  'opt.thinnest': {
    one: 'cel mai rar tronson: {n} tren pe oră',
    few: 'cel mai rar tronson: {n} trenuri pe oră',
    other: 'cel mai rar tronson: {n} de trenuri pe oră',
  },

  // ---- Plan B: legend. green, amber and red are the colours of the chips and lines
  'legend.green': 'verde',
  'legend.amber': 'portocaliu',
  'legend.red': 'roșu',
  'legend.basePlan': 'planul dvs.',
  'legend.baseBest': 'cea mai bună variantă',
  'legend.good': 'până la {n} min după {base}',
  'legend.mid': 'până la {n} min',
  'legend.bad': 'mai mult de atât.',
  'legend.thick': 'Grosimea liniei: trenuri pe oră pe tronsonul respectiv, de la unul (subțire) la patru sau mai multe (groasă).',
  'legend.dotted': 'Linia punctată: planul pe care îl aveați.',
  'legend.context': 'Gri: celelalte gări la care se poate ajunge de aici.',

  // ---- Plan B: where you are
  'loc.looking': 'Se caută poziția dvs...',
  'loc.unsupported': 'Acest browser nu poate stabili unde vă aflați. Alegeți gara după nume.',
  'loc.denied': 'Locația nu este permisă pentru această pagină. Permiteți-o pentru acest site în setările browserului sau alegeți gara după nume.',
  'loc.unavailable': 'Dispozitivul nu a putut stabili unde vă aflați. Alegeți gara după nume.',
  'loc.timeout': 'Găsirea poziției a durat prea mult. Încercați din nou sau alegeți gara după nume.',
  'loc.none': 'Nicio gară cu trenuri regionale pe o rază de 40 km. Alegeți gara după nume.',
  'loc.near': 'Vă aflați lângă {station} ({dist}). Data și ora au fost setate la momentul actual.',
  'loc.rough': 'Poziția este precisă doar la aproximativ {km} km, așa că verificați gara.',
  'loc.private': 'Poziția dvs. rămâne pe acest dispozitiv.',
  'loc.notHere': 'Nu sunteți aici?',

  // ---- search errors
  'err.sameStation': 'Gara de plecare și gara de destinație sunt aceeași.',
  'err.viaUnreachable': 'La oprirea aleasă nu se poate ajunge după ora de plecare.',
  'err.noOnward': 'Nicio legătură mai departe după oprire; încercați o oprire mai scurtă sau o plecare mai devreme.',
  'err.noConnection': 'Nicio legătură în acea zi după ora de plecare.',
  'err.alreadyThere': 'Sunteți deja la destinație.',
  'err.noWay': 'De aici nu se mai poate ajunge la destinație după acea oră.',

  // ---- footer
  'foot': 'Orar: {publisher}, {license}. Gări: {stations}, conexiuni: {connections}, perioada {first} – {last}. Doar ore planificate, fără întârzieri sau lucrări pe linie. Verificați călătoria în DB Navigator înainte de plecare.',

  // ---- units. {n} is a number
  'unit.h': 'h',
  'unit.min': 'min',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.perHour': '{n}/h',

  // ---- the page for an address that does not exist
  'nf.title': 'Pagină negăsită',
  'nf.body': 'La această adresă nu există nicio pagină. {app} planifică lanțuri de trenuri regionale cu Deutschlandticket, offline.',
};
