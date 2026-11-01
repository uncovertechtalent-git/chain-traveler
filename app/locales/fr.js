// Français. Same keys as en.js. Uses a no-break space ( ) before : ; ? as French typography asks.
export default {
  // ---- header, status, language
  'lang.label': 'Langue',
  'meta.sub': 'Enchaînez les prochains trains régionaux entre deux gares allemandes avec le Deutschlandticket, et faites étape où vous voulez. Heures prévues, lues hors ligne dans les horaires enregistrés sur cet appareil.',
  'status.loading': 'Chargement des horaires...',
  'status.first': 'Premier chargement des horaires (environ 5 Mo)...',
  'status.loadFailed': 'Impossible de charger les horaires ({message}). Le premier lancement nécessite une connexion internet.',
  'status.noCache': 'Ce navigateur ne peut pas conserver les horaires sur l’appareil (il faut Cache Storage via HTTPS). Essayez un navigateur récent.',
  'status.readFailed': 'Impossible de lire les horaires enregistrés : {message}',
  'btn.retry': 'Réessayer',

  // ---- age of the timetable
  'age.expired': 'Les horaires s’arrêtent au {last}. Les trains après cette date n’y figurent pas ; connectez-vous à internet pour les mettre à jour.',
  'age.soon': 'Horaires du {date}, valables jusqu’au {last} ({left}). Mise à jour automatique dès que vous êtes en ligne.',
  'age.lastDay': 'dernier jour',
  'age.moreDays': { one: 'encore {n} jour', other: 'encore {n} jours' },
  'age.ok': 'Horaires du {date}, valables jusqu’au {last}.',
  'age.offline': 'Hors ligne : horaires de l’appareil utilisés.',
  'age.updated': 'Mis à jour à l’instant.',
  'age.upToDate': 'À jour.',
  'age.checkFailed': 'Impossible de vérifier s’il existe des horaires plus récents ({code}) ; les données de l’appareil sont inchangées.',

  // ---- the trip form
  'aria.trip': 'Trajet',
  'field.station': 'Gare',
  'field.start': 'Départ',
  'field.date': 'Date',
  'field.leaveAfter': 'Partir après',
  'field.target': 'Destination',
  'field.via': 'Étape (facultative)',
  'field.stay': 'Séjour minimum (min)',
  'field.change': 'Correspondance minimum (min)',
  'btn.plan': 'Planifier la chaîne',
  'btn.swap': 'Inverser départ et destination',
  'btn.clearvia': 'Sans étape',

  // ---- tabs
  'tab.chain': 'Chaîne',
  'tab.reach': 'Carte',
  'tab.deps': 'Départs',
  'tab.live': 'Plan B',

  // ---- chain
  'chain.intro': 'Choisissez une gare de départ et une gare de destination pour enchaîner les prochains trains régionaux entre les deux.',
  'chain.pickBoth': 'Choisissez une gare de départ et une gare de destination dans les suggestions.',
  'chain.noTrainToday': 'Aucun train utilisable depuis {from} le {day} après {time}. La première chaîne part le {first}.',
  'chain.timeRange': '{dep} à {arr}',
  'leg.fromTo': '{from} à {to}',
  'chain.onTheWay': 'de trajet',
  'chain.changes': { one: 'correspondance', other: 'correspondances' },
  'chain.changesStop': { one: 'correspondance plus l’étape', other: 'correspondances plus l’étape' },
  'chain.stay': 'Étape à {station} : arrivée {arr}, départ {dep} ({dur})',
  'chain.wait': '{min} d’attente à {station}',
  'chain.waitTight': '{min} d’attente à {station} (correspondance serrée)',
  'chain.walk': 'À pied : {from} → {to}',
  'leg.towards': 'direction {term}, {dur}',
  'btn.out': 'Ce train est supprimé ?',
  'chain.nextTrains': 'Prochains trains à chaque arrêt',
  'chain.arrive': '(arrivée {time})',
  'dep.towards': 'direction {term}',
  'dep.nextStop': 'prochain arrêt {stop}',

  // ---- reach map
  'reach.within': 'Afficher les gares atteintes en {hours} h après le départ',
  'reach.sooner': 'plus tôt',
  'reach.later': 'plus tard',
  'reach.note': 'Chaque point est une gare accessible en train régional. La couleur indique en combien de temps vous pouvez y être depuis la gare de départ. Cliquez sur un point pour y planifier une chaîne.',

  // ---- departures
  'field.after': 'À partir de',
  'deps.pick': 'Choisissez une gare.',
  'deps.none': 'Aucun départ après cette heure.',
  'deps.th.departs': 'Départ',
  'deps.th.line': 'Ligne',
  'deps.th.towards': 'Direction',
  'deps.th.next': 'Prochain arrêt',

  // ---- Plan B
  'live.intro': 'Votre train est supprimé ? Indiquez où vous êtes et où vous allez. Vous obtenez les options pour continuer d’ici, chacune comparée à votre plan, et le nombre de trains par heure sur chaque tronçon.',
  'field.iAmAt': 'Je suis à',
  'field.timeNow': 'Heure actuelle',
  'field.goingTo': 'Je vais à',
  'field.plannedArr': 'Arrivée prévue (facultatif)',
  'btn.locate': 'Utiliser ma position',
  'live.say': 'Indiquez où vous êtes et où vous allez.',
  'live.depsTitle': 'Trains depuis {station} après {time}',
  'live.noMoreToday': 'Aucun train ne quitte {station} à cette date après {time} dans les horaires. Voici ceux du lendemain (+1).',
  'live.tick': 'Cochez les trains supprimés.',
  'live.unlisted': { one: '{n} autre train déjà marqué supprimé, absent de cette liste.', other: '{n} autres trains déjà marqués supprimés, absents de cette liste.' },
  'live.leadPlan': 'Votre plan arrivait à {plan}. La meilleure option pour continuer arrive à {best}{later}.',
  'live.later': ', {dur} plus tard',
  'live.leadBest': 'Aucune arrivée prévue indiquée : la meilleure option (arrivée {best}) sert de référence.',
  'graph.label': 'Options : {from} à {to}',

  // ---- Plan B: how a way compares
  'chip.best': 'meilleure option',
  'chip.best.good': 'proche de la meilleure, +{dur}',
  'chip.best.mid': 'plus tard, +{dur}',
  'chip.best.bad': 'beaucoup plus tard, +{dur}',
  'chip.plan.early': 'comme prévu, {dur} plus tôt',
  'chip.plan.exact': 'comme prévu',
  'chip.plan.good': 'comme prévu, +{dur}',
  'chip.plan.mid': 'en retard, +{dur}',
  'chip.plan.bad': 'beaucoup plus tard, +{dur}',
  'tag.earliest': 'Arrivée au plus tôt',
  'tag.fewest': 'Moins de correspondances',
  'tag.robust': 'Plus de trains par heure',
  'opt.arrive': 'arrivée',
  'opt.leave': 'départ {time}',
  'opt.changes': { one: '{n} correspondance', other: '{n} correspondances' },
  'opt.tightest': 'correspondance la plus serrée {min}',
  'opt.thinnest': { one: 'tronçon le moins fréquent : {n} train par heure', other: 'tronçon le moins fréquent : {n} trains par heure' },

  // ---- Plan B: legend. green, amber and red are the colours of the chips and lines
  'legend.green': 'vert',
  'legend.amber': 'orange',
  'legend.red': 'rouge',
  'legend.basePlan': 'votre plan',
  'legend.baseBest': 'la meilleure option',
  'legend.good': 'jusqu’à {n} min après {base}',
  'legend.mid': 'jusqu’à {n} min',
  'legend.bad': 'au-delà.',
  'legend.thick': 'Épaisseur du trait : trains par heure sur ce tronçon, de un (fin) à quatre ou plus (épais).',
  'legend.dotted': 'Le trait pointillé : votre plan initial.',

  // ---- Plan B: where you are
  'loc.looking': 'Recherche de votre position...',
  'loc.unsupported': 'Ce navigateur ne peut pas vous localiser. Choisissez la gare par son nom.',
  'loc.denied': 'La localisation n’est pas autorisée pour cette page. Autorisez-la pour ce site dans les paramètres du navigateur, ou choisissez la gare par son nom.',
  'loc.unavailable': 'L’appareil n’a pas pu déterminer votre position. Choisissez la gare par son nom.',
  'loc.timeout': 'La recherche de votre position a pris trop de temps. Réessayez ou choisissez la gare par son nom.',
  'loc.none': 'Aucune gare desservie par des trains régionaux à moins de 40 km. Choisissez la gare par son nom.',
  'loc.near': 'Gare à proximité : {station} ({dist}). Date et heure réglées sur maintenant.',
  'loc.rough': 'La position n’est précise qu’à {km} km environ ; vérifiez donc la gare.',
  'loc.private': 'Votre position reste sur cet appareil.',
  'loc.notHere': 'Pas ici ?',

  // ---- search errors
  'err.sameStation': 'Le départ et la destination sont la même gare.',
  'err.viaUnreachable': 'L’étape n’est pas atteignable après l’heure de départ.',
  'err.noOnward': 'Aucune correspondance après le séjour ; essayez un séjour plus court ou un départ plus tôt.',
  'err.noConnection': 'Aucune liaison ce jour-là après l’heure de départ.',
  'err.alreadyThere': 'Vous êtes déjà à destination.',
  'err.noWay': 'Aucune possibilité de rejoindre la destination d’ici après cette heure.',

  // ---- footer
  'foot': 'Horaires : {publisher}, {license}. {stations} gares, {connections} liaisons, du {first} au {last}. Heures prévues uniquement, sans retards ni travaux. Vérifiez votre trajet dans DB Navigator avant de partir.',

  // ---- units. {n} is a number
  'unit.h': 'h',
  'unit.min': 'min',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.perHour': '{n}/h',

  // ---- the page for an address that does not exist
  'nf.title': 'Introuvable',
  'nf.body': 'Il n’y a aucune page à cette adresse. {app} planifie des chaînes de trains régionaux avec le Deutschlandticket, hors ligne.',
};
